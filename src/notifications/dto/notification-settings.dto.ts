import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'dailyAgendaTime must be HH:MM' })
  dailyAgendaTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'quietHoursStart must be HH:MM' })
  quietHoursStart?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'quietHoursEnd must be HH:MM' })
  quietHoursEnd?: string | null;
}
