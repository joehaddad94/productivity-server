import { IsString } from 'class-validator';

export class SavePushSubscriptionDto {
  @IsString()
  endpoint: string;

  @IsString()
  p256dh: string;

  @IsString()
  auth: string;
}
