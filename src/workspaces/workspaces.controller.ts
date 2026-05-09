import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import {
  CurrentUser,
  RequestUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

@ApiTags('workspaces')
@Controller('workspaces')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a workspace' })
  @ApiResponse({
    status: 201,
    description: 'Workspace created; current user is owner',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateWorkspaceDto,
  ) {
    const workspace = await this.workspacesService.create(dto, user.id);
    return { workspace };
  }

  @Get()
  @ApiOperation({ summary: 'List workspaces for the current user' })
  @ApiResponse({
    status: 200,
    description: 'Workspaces the user is a member of',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(@CurrentUser() user: RequestUser) {
    const workspaces = await this.workspacesService.findByUserId(user.id);
    return { workspaces };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a workspace by id' })
  @ApiResponse({ status: 200, description: 'Workspace details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const workspace = await this.workspacesService.findOne(id, user.id);
    return { workspace };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a workspace' })
  @ApiResponse({ status: 200, description: 'Workspace updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    const workspace = await this.workspacesService.update(id, user.id, dto);
    return { workspace };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a workspace' })
  @ApiResponse({ status: 200, description: 'Workspace deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Only the owner can delete the workspace',
  })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.workspacesService.remove(id, user.id);
    return { success: true };
  }

  // --- Member management ---

  @Get(':id/members')
  @ApiOperation({ summary: 'List workspace members' })
  @ApiResponse({ status: 200, description: 'Members list' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async listMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const members = await this.workspacesService.listMembers(id, user.id);
    return { members };
  }

  @Post(':id/members/invite')
  @ApiOperation({ summary: 'Invite a user to the workspace' })
  @ApiResponse({ status: 201, description: 'Invite sent or user added' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async inviteMember(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: InviteMemberDto,
  ) {
    return this.workspacesService.inviteMember(id, user.id, dto);
  }

  @Patch(':id/members/:userId')
  @ApiOperation({ summary: 'Update a member role (owner only)' })
  @ApiResponse({ status: 200, description: 'Member role updated' })
  @ApiResponse({ status: 403, description: 'Owner only' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async updateMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateMemberDto,
  ) {
    const member = await this.workspacesService.updateMemberRole(
      id,
      user.id,
      targetUserId,
      dto,
    );
    return { member };
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a workspace member (owner only)' })
  @ApiResponse({ status: 200, description: 'Member removed' })
  @ApiResponse({ status: 403, description: 'Owner only' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.workspacesService.removeMember(id, user.id, targetUserId);
    return { success: true };
  }
}
