import { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient, App, Prisma, AIResource, Message } from '@prisma/client';
import * as lark from '@larksuiteoapi/node-sdk';
import { ReceiveMessageEvent, Sender, User, Message as FeishuReceivedMessage } from 'types/feishu';
import MessageQueue from 'pages/api/queues/messages';
import { NotFoundError } from '@prisma/client/runtime/library';
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
      type: 'FEISHU',
      eventName: event.name,
      processing: true,
      createdAt: new Date(Number(event.data.message.create_time))
    }
  });

  //@ts-ignore
  const messageData = receivedMessage.data as FeishuReceivedMessage;
  const matched = await findSensitiveWords(JSON.parse(messageData.content).text, app.organizationId);


    let history: Message[] = [];
    if (event.data.message.root_id && event.data.message.root_id != event.data.message.message_id) {
      history = await prisma.message.findMany({
        where: {
          conversationId: event.data.message.root_id, 
          isAIAnswer: true,
        },
        orderBy: [
          {
            createdAt: 'desc'
          }
        ],
        take: 50
      });
    }
  
    // Send to queue.
    await MessageQueue.enqueue(
      { receivedMessage: receivedMessage, history: history, app: app, sensitiveWords: matched }, // job to be enqueued
      { delay: 1 } // scheduling options
    );
  
  

  res.end('ok');
};

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
      if (event.name === 'im.message.receive_v1') {
        handleFeishuMessage(client, event, app, res);
      } else {
        res.end('ok');
      }
    }
  }
};

