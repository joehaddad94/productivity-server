import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { CurrentUser, RequestUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddTagsDto } from './dto/add-tags.dto';
import { TagsService } from './tags.service';

@ApiTags('tags')
@Controller('workspaces/:workspaceId/notes/:noteId/tags')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NoteTagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Post()
  @ApiOperation({ summary: 'Add tags to a note (normalises + dedups)' })
  @ApiResponse({ status: 201, description: 'Note with updated tags' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async addTags(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: AddTagsDto,
  ) {
    const note = await this.tagsService.addTags(workspaceId, noteId, user.id, dto.tags);
    return { note };
  }

  @Delete(':tag')
  @ApiOperation({ summary: 'Remove a tag from a note' })
  @ApiResponse({ status: 200, description: 'Note with updated tags' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async removeTag(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Param('tag') tag: string,
    @CurrentUser() user: RequestUser,
  ) {
    const note = await this.tagsService.removeTag(
      workspaceId,
      noteId,
      user.id,
      decodeURIComponent(tag),
    );
    return { note };
  }
}
