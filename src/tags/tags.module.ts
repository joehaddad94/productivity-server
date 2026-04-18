import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NoteTagsController } from './note-tags.controller';
import { TagsService } from './tags.service';
import { WorkspaceTagsController } from './workspace-tags.controller';

@Module({
  imports: [AuthModule],
  controllers: [NoteTagsController, WorkspaceTagsController],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
