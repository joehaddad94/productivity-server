import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AUTH_CONFIG, parseExpiresInToSeconds } from './config/auth-config';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SendMagicLinkDto } from './dto/send-magic-link.dto';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { CurrentUser, RequestUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const COOKIE_NAME = AUTH_CONFIG.COOKIE_NAME;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
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

  private clearAuthCookie(res: Response): void {
    const isProduction = this.config.get('NODE_ENV') === 'production';
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });
  }

  @Post('register')
  @ApiOperation({
    summary:
      'Register: save email, send magic link. No sign-in until user clicks link.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({
    status: 201,
    description: 'User created; check email for magic link',
  })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(
    @Body() dto: RegisterDto,
  ): Promise<{ message: string; magicLink?: string }> {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Request magic link to sign in; no session until user clicks link',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description:
      'Magic link sent; check email (or link in body when SMTP not configured)',
  })
  @ApiResponse({ status: 401, description: 'No account for this email' })
  async login(
    @Body() dto: LoginDto,
  ): Promise<{ message: string; magicLink?: string }> {
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
  @ApiOperation({
    summary:
      'Send magic link to email (via SMTP if SMTP_USER/SMTP_PASS are set)',
  })
  @ApiBody({ type: SendMagicLinkDto })
  @ApiResponse({
    status: 200,
    description:
      'Magic link sent by email, or link in body when SMTP not configured',
  })
  async sendMagicLink(
    @Body() dto: SendMagicLinkDto,
  ): Promise<{ magicLink?: string; message?: string }> {
    return this.authService.sendMagicLink(dto.email);
  }

  @Get('verify')
  @ApiOperation({
    summary:
      'Verify magic link; JWT in HttpOnly cookie. Redirects to AUTH_VERIFY_REDIRECT_URL if set.',
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
  async verifyMagicLink(
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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user (cookie or Authorization header)',
  })
  @ApiResponse({ status: 200, description: 'Current user' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  me(@CurrentUser() user: RequestUser) {
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        timezone: user.timezone,
      },
    };
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile (name, timezone)' })
  @ApiResponse({ status: 200, description: 'Updated user' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateMe(
    @CurrentUser() user: RequestUser,
    @Body() body: { name?: string; timezone?: string },
  ) {
    const updated = await this.usersService.updateProfile(user.id, {
      name: body.name,
      timezone: body.timezone,
    });
    return {
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        isAdmin: updated.isAdmin,
        timezone: updated.timezone ?? null,
      },
    };
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Permanently delete the current user account and all data',
  })
  @ApiResponse({ status: 200, description: 'Account deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteMe(@CurrentUser() user: RequestUser) {
    await this.usersService.deleteAccount(user.id);
    return { message: 'Account deleted' };
  }

  /**
   * Dev/test only — creates or retrieves a user and returns a valid session cookie.
   * Disabled in production (NODE_ENV=production).
   */
  @Post('dev-session')
  @ApiOperation({
    summary: '[Dev/test only] Instantly create an authenticated session',
  })
  @ApiResponse({ status: 201, description: 'Session created; cookie set' })
  @ApiResponse({ status: 403, description: 'Not available in production' })
  async devSession(
    @Body() body: { email: string; name?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (this.config.get('NODE_ENV') === 'production') {
      res.status(403).json({ message: 'Not available in production' });
      return;
    }

    const result = await this.authService.createDevSession(
      body.email,
      body.name,
    );
    this.setAuthCookie(res, result.accessToken);
    return { user: result.user };
  }
}
