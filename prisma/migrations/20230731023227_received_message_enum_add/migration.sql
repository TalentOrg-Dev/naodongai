-- AlterTable
ALTER TABLE `ReceivedMessage` MODIFY `type` ENUM('FEISHU', 'WEWORK', 'DINGTALK', 'WEB', 'UNKNOWN', 'FEISHUSUMMARY') NOT NULL DEFAULT 'UNKNOWN';
