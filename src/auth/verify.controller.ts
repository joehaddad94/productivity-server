import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { AUTH_CONFIG, parseExpiresInToSeconds } from './config/auth-config';
import { AuthResponseDto } from './dto/auth-response.dto';

const COOKIE_NAME = AUTH_CONFIG.COOKIE_NAME;

@ApiTags('auth')
@Controller()
export class VerifyController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private setAuthCookie(res: Response, accessToken: string): void {
    const expiresIn =
      this.config.get<string>(AUTH_CONFIG.JWT_EXPIRES_IN) ??
      AUTH_CONFIG.JWT_EXPIRES_IN_DEFAULT;
    const maxAgeSec = parseExpiresInToSeconds(expiresIn);
    const isProduction = this.config.get('NODE_ENV') === 'production';
    res.cookie(COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: maxAgeSec * 1000,
      path: '/',
    });
  }

  @Get('verify')
  @ApiOperation({
    summary: 'Fallback verify route for magic links landing on API host',
  })
  @ApiQuery({
    name: 'token',
    required: true,
    description: 'Token from magic link',
  })
  @ApiResponse({
    status: 200,
    description: 'Signed in; cookie set',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to AUTH_VERIFY_REDIRECT_URL after setting cookie',
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired link' })
  async verifyMagicLinkFallback(
    @Query('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.verifyMagicLink(token);
    this.setAuthCookie(res, result.accessToken);

    const redirectUrl = this.config.get<string>(
      AUTH_CONFIG.VERIFY_REDIRECT_URL,
    );
    if (redirectUrl) {
      res.redirect(302, redirectUrl);
      return undefined as unknown as AuthResponseDto;
    }
    return { user: result.user };
  }
}
