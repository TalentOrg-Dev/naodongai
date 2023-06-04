import { Queue } from "quirrel/next"
import { processFeishuMessage } from "../process/[...messageId]";

export default Queue(
  "api/queues/messages", // 👈 the route it's reachable on
  async ( message)=> {
    await processFeishuMessage(message.id);
  }
)