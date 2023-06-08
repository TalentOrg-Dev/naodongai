import { Queue } from 'utils/quirrel/edge';
import { processFeishuMessage } from '../process/[...messageId]';

export type MessageQueueBody = {
  feishuMessage;
  history;
  app;
}

export default Queue(
  'api/queues/messages', // 👈 the route it's reachable on
  async (messageQueueBody: MessageQueueBody) => {
    return await processFeishuMessage(messageQueueBody);
  }
);


export const config = {
  runtime: 'edge',
};


