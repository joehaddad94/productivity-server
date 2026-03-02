import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AUTH_CONFIG, parseExpiresInToSeconds } from './config/auth-config';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SendMagicLinkDto } from './dto/send-magic-link.dto';
import { AuthService } from './auth.service';
import { CurrentUser, RequestUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const COOKIE_NAME = AUTH_CONFIG.COOKIE_NAME;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private setAuthCookie(res: Response, accessToken: string): void {
    const expiresIn = this.config.get(AUTH_CONFIG.JWT_EXPIRES_IN) ?? AUTH_CONFIG.JWT_EXPIRES_IN_DEFAULT;
    const maxAgeSec = parseExpiresInToSeconds(expiresIn);
    const isProduction = this.config.get('NODE_ENV') === 'production';
    res.cookie(COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: maxAgeSec * 1000, // milliseconds
      path: '/',
    });
  }

  private clearAuthCookie(res: Response): void {
    const isProduction = this.config.get('NODE_ENV') === 'production';
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/',
    });
  }

  @Post('register')
  @ApiOperation({ summary: 'Register: save email, send magic link. No sign-in until user clicks link.' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'User created; check email for magic link' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() dto: RegisterDto): Promise<{ message: string; magicLink?: string }> {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Request magic link to sign in; no session until user clicks link' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Magic link sent; check email (or link in body when Resend not configured)' })
  @ApiResponse({ status: 401, description: 'No account for this email' })
  async login(@Body() dto: LoginDto): Promise<{ message: string; magicLink?: string }> {
    return this.authService.login(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out (invalidates session and clears cookie)' })
  @ApiResponse({ status: 200, description: 'Logged out' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.authService.logout(user.sessionId);
    this.clearAuthCookie(res);
    return { message: 'Logged out' };
  }

  @Post('send-magic-link')
  @ApiOperation({ summary: 'Send magic link to email (via Resend if RESEND_API_KEY is set)' })
  @ApiBody({ type: SendMagicLinkDto })
  @ApiResponse({ status: 200, description: 'Magic link sent by email, or link in body when Resend not configured' })
  async sendMagicLink(@Body() dto: SendMagicLinkDto): Promise<{ magicLink?: string; message?: string }> {
    return this.authService.sendMagicLink(dto.email);
  }

  @Get('verify')
  @ApiOperation({ summary: 'Verify magic link; JWT in HttpOnly cookie. Redirects to AUTH_VERIFY_REDIRECT_URL if set.' })
  @ApiQuery({ name: 'token', required: true, description: 'Token from magic link' })
  @ApiResponse({ status: 200, description: 'Signed in; cookie set', type: AuthResponseDto })
  @ApiResponse({ status: 302, description: 'Redirect to AUTH_VERIFY_REDIRECT_URL after setting cookie' })
  @ApiResponse({ status: 400, description: 'Invalid or expired link' })
  async verifyMagicLink(
    @Query('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.verifyMagicLink(token);
    this.setAuthCookie(res, result.accessToken);

    const redirectUrl = this.config.get(AUTH_CONFIG.VERIFY_REDIRECT_URL);
    if (redirectUrl) {
      res.redirect(302, redirectUrl);
      return undefined as unknown as AuthResponseDto;
    }
    return { user: result.user };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user (cookie or Authorization header)' })
  @ApiResponse({ status: 200, description: 'Current user' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  me(@CurrentUser() user: RequestUser) {
    return { user };
  }
}
