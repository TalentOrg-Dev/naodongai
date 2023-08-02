import * as lark from '@larksuiteoapi/node-sdk';
import { AIResource, App, Message, Prisma, PrismaClient } from '@prisma/client';
import { NotFoundError } from '@prisma/client/runtime/library';
import { ChatCommands, OpenAITemperature, ServiceCard, chatModeHistory } from 'constant';
import { NextApiRequest, NextApiResponse } from 'next';
import MessageQueue from 'pages/api/queues/messages';
import { ReceiveMessageData, ReceiveMessageEvent } from 'types/feishu';
import { findSensitiveWords } from 'utils/db/transactions';

const prisma = new PrismaClient();

const findApp = async (id: string) => {
  return await prisma.app.findUniqueOrThrow({
    where: {
      id
    },
    include: {
      aiResource: true
    }
  });
};

const eventDispatcher = (app: App & { aiResource: AIResource }) => {
  if (app.config === null) {
    throw Error('App is not configed');
  }

  const config = app.config as Prisma.JsonObject;
  const client = new lark.Client({
    appId: config['appId'] as string,
    appSecret: config['appSecret'] as string,
    appType: lark.AppType.SelfBuild,
    domain: config['domain'] as string
  });
  return new lark.EventDispatcher({
    encryptKey: config['encryptKey'] || config['appEncryptKey'],
    verificationToken: config['verificationToken'] || config['appVerificationToken'],
  }).register({
    'im.message.receive_v1': async (data) => {
      if (!app.aiResource) {
        const chatId = data.message.chat_id;
        const res = await client.im.message.reply({
          path: {
            message_id: data.message.message_id
          },
          data: {
            content: JSON.stringify({ text: '应用资源配置有误。' }),
            msg_type: 'text'
          }
        });
        return res;
      }
      if (app.aiResource.tokenRemains <= 0) {
        const chatId = data.message.chat_id;
        const res = await client.im.message.reply({
          path: {
            message_id: data.message.message_id
          },
          data: {
            content: JSON.stringify({ text: 'Token已耗尽，请联系相关人员添加Token' }),
            msg_type: 'text'
          }
        });
        return res;
      } else {
        return { name: 'im.message.receive_v1', data };
      }
    }
  });
};

const handleFeishuMessage = async (
  client: lark.Client,
  event: ReceiveMessageEvent,
  app: App & { aiResource: AIResource },
  res: NextApiResponse
) => {
  let receivedMessage = await prisma.receivedMessage.findUnique({ where: { id: event.data.message.message_id } });
  if (receivedMessage?.processing) {
    res.status(400).end('messege in processing');
    return;
  }
  if (receivedMessage && !receivedMessage.processing) {
    res.end('ok');
    return;
  }
  const message = await prisma.message.findUnique({ where: { id: event.data.message.message_id } });
  if (message) {
    res.end('ok');
    return;
  }
  receivedMessage = await prisma.receivedMessage.create({
    data: {
      id: event.data.message.message_id,
      appId: app.id,
      data: event.data,
      type: 'FEISHUSUMMARY',
      eventName: event.name,
      processing: true,
      createdAt: new Date(Number(event.data.message.create_time))
    }
  });

  //@ts-ignore
  const messageData = receivedMessage.data as ReceiveMessageData;
  const matched = await findSensitiveWords(JSON.parse(messageData.message.content).text, app.organizationId);


  let history: Message[] = [];
  // Send to queue.
  await MessageQueue.enqueue(
    { receivedMessage: receivedMessage, history: history, app: app, sensitiveWords: matched }, // job to be enqueued
    { delay: 1 } // scheduling options
  );



  res.end('ok');
};
/**
 * 根据内容判断是否为摘要模块
 * @param event 消息内容
 * @param res 
 * @returns 返回状态：true：代表是摘要，false:代表非摘要
 */
const judgingSummary = async (
  event: ReceiveMessageEvent,
  res: NextApiResponse
) => {
  let summaryStatus = false;
  let text = JSON.parse(event.data.message.content).text;
  if (/@_user_\d/.test(text)) {
    text = text.replace(/@_user_\d/, '').trim();
  }
  text=text.toLowerCase();
  //判断是否为摘要
  if (chatModeHistory.name.indexOf(text) != -1) {
    summaryStatus = true;
  }
  return summaryStatus;
}
/** 
 * 判断是否在群组@机器人
 * return 返回 true 表示@机器人或单聊。false 表示基本消息或者不是@机器人
 * */
const judgingRobots = (
  event: ReceiveMessageEvent,
  app: App
) => {
  let robotStatus = false;
  if (event.data.message.chat_type === 'group' && event.data.message.mentions) {
    const mentions = event.data.message.mentions;
    mentions.some(mention => {
      if (mention.name === app.name && mention.id && !mention.id.user_id) {
        robotStatus = true;
      }
    })
  } else if (event.data.message.chat_type === 'p2p') {
    robotStatus = true;
  }
  return robotStatus;
}

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const { appId } = req.query;
  let id = null;
  if (Array.isArray(appId)) {
    id = appId[0];
  } else {
    id = appId;
  }
  if (!id) {
    res.status(404).end('not found');
    return;
  }

  let app;
  try {
    app = await findApp(id);
  } catch (e: unknown) {
    if (e instanceof NotFoundError) {
      res.status(404).end('not found');
      return
    } else {
      throw e;
    }
  }

  if (req.body && req.body['type'] && req.body['type'] === 'url_verification') {
    res.end(JSON.stringify({ challenge: req.body['challenge'] }));
  } else if (req.body && req.body['encrypt']) {
    const config = app.config as Prisma.JsonObject;
    const client = new lark.Client({
      appId: config['appId'] as string,
      appSecret: config['appSecret'] as string,
      appType: lark.AppType.SelfBuild,
      domain: config['domain'] as string
    });

    const r = lark.generateChallenge(req.body, { encryptKey: config['appEncryptKey'] || config['encryptKey'] });
    if (r.isChallenge) {
      res.end(JSON.stringify(r.challenge));
    } else {
      const dispatcher = eventDispatcher(app);
      const data = Object.assign(
        Object.create({
          headers: req.headers
        }),
        req.body
      );

      const event = (await dispatcher.invoke(data)) as ReceiveMessageEvent;

      if (event.name === 'im.message.receive_v1' && judgingRobots(event, app)) {
        //判断是不是摘要模块。是则发送卡片消息，不是则继续往下调用
        let summaryStatus = await judgingSummary(event, res);
        if (summaryStatus) {
          handleFeishuMessage(client, event, app, res);
        } else {
          res.end('ok');
        }

      } else {
        res.end('ok');
      }
    }
  }
};

