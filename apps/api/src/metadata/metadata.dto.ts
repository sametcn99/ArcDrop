import { ApiProperty } from '@nestjs/swagger';
import { MaxLength } from 'class-validator';

/** Path param for `GET /icons/{id}` — the unguessable icon ref (D18). */
export class IconRefParamDto {
  @ApiProperty({
    description: 'Icon ref as stored on the bookmark (coverRef / iconRef)',
    example: 'Vx8kQ2mRzP9wLnT4cJb7HgYfAsDe6uO1.png',
  })
  @MaxLength(256)
  id!: string;
}

export class ReindexBookmarkResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  /** Always `scheduled` — the pipeline runs asynchronously (and silently). */
  @ApiProperty({ enum: ['scheduled'], example: 'scheduled' })
  status!: 'scheduled';
}

