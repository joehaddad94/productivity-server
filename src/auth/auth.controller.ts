import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SendMagicLinkDto } from './dto/send-magic-link.dto';
import { AuthService } from './auth.service';
import { CurrentUser, RequestUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register with email (no password)' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'User created', type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login with email (no password)' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'No account for this email' })
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out (invalidates current session)' })
  @ApiResponse({ status: 200, description: 'Logged out' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@CurrentUser() user: RequestUser): Promise<{ message: string }> {
    await this.authService.logout(user.sessionId);
    return { message: 'Logged out' };
  }

  @Post('send-magic-link')
  @ApiOperation({ summary: 'Send magic link to email (dev: returns link in response)' })
  @ApiBody({ type: SendMagicLinkDto })
  @ApiResponse({ status: 200, description: 'Magic link created; in production send by email' })
  async sendMagicLink(@Body() dto: SendMagicLinkDto): Promise<{ magicLink: string }> {
    return this.authService.sendMagicLink(dto.email);
  }

  @Get('verify')
  @ApiOperation({ summary: 'Verify magic link token and sign in' })
  @ApiQuery({ name: 'token', required: true, description: 'Token from magic link' })
  @ApiResponse({ status: 200, description: 'Signed in', type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid or expired link' })
  async verifyMagicLink(@Query('token') token: string): Promise<AuthResponseDto> {
    return this.authService.verifyMagicLink(token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user (requires JWT)' })
  @ApiResponse({ status: 200, description: 'Current user' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  me(@CurrentUser() user: RequestUser) {
    return { user };
  }
}
