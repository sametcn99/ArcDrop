import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import AudiotrackOutlinedIcon from '@mui/icons-material/AudiotrackOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import OndemandVideoOutlinedIcon from '@mui/icons-material/OndemandVideoOutlined';
import type { BookmarkContentType } from '../../api/schemas/bookmarks';

export interface ContentTypeIconProps {
  contentType: BookmarkContentType;
}

export function ContentTypeIcon({ contentType }: ContentTypeIconProps) {
  switch (contentType) {
    case 'article':
      return <ArticleOutlinedIcon fontSize="small" />;
    case 'image':
      return <ImageOutlinedIcon fontSize="small" />;
    case 'video':
      return <OndemandVideoOutlinedIcon fontSize="small" />;
    case 'audio':
      return <AudiotrackOutlinedIcon fontSize="small" />;
    case 'document':
      return <DescriptionOutlinedIcon fontSize="small" />;
    case 'book':
      return <MenuBookOutlinedIcon fontSize="small" />;
    case 'link':
      return <LinkOutlinedIcon fontSize="small" />;
  }
}
