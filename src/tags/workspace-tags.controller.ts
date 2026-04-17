import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RenameTagDto } from './dto/rename-tag.dto';
import { TagsService } from './tags.service';

@ApiTags('tags')
@Controller('workspaces/:workspaceId/tags')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WorkspaceTagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  @ApiOperation({ summary: 'List all tags used in a workspace with counts' })
  @ApiResponse({ status: 200, description: 'Array of { tag, count }' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const tags = await this.tagsService.listWorkspaceTags(workspaceId, user.id);
    return { tags };
  }

  @Post('rename')
  @ApiOperation({ summary: 'Rename a tag across every note in the workspace' })
  @ApiResponse({ status: 201, description: 'Number of notes updated' })
  async rename(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RenameTagDto,
  ) {
    return this.tagsService.renameTag(workspaceId, user.id, dto.from, dto.to);
  }

  @Delete(':tag')
  @ApiOperation({ summary: 'Remove a tag from every note in the workspace' })
  @ApiResponse({ status: 200, description: 'Number of notes updated' })
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('tag') tag: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tagsService.deleteTag(workspaceId, user.id, decodeURIComponent(tag));
  }
}
