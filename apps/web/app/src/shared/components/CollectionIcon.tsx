import AutoStoriesOutlinedIcon from '@mui/icons-material/AutoStoriesOutlined';
import BookmarkBorderOutlinedIcon from '@mui/icons-material/BookmarkBorderOutlined';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import CollectionsOutlinedIcon from '@mui/icons-material/CollectionsOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import MusicNoteOutlinedIcon from '@mui/icons-material/MusicNoteOutlined';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import StarBorderOutlinedIcon from '@mui/icons-material/StarBorderOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined';
import type { SvgIconProps } from '@mui/material/SvgIcon';

export interface CollectionIconProps extends SvgIconProps {
  iconName: string | null | undefined;
  colorValue?: string | null;
}

export function CollectionIcon({
  iconName,
  colorValue,
  sx,
  fontSize = 'small',
  ...props
}: CollectionIconProps) {
  const mergedSx = colorValue ? [{ color: colorValue }, ...(Array.isArray(sx) ? sx : [sx])] : sx;

  switch (iconName) {
    case 'bookmark':
      return <BookmarkBorderOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'star':
      return <StarBorderOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'work':
      return <WorkOutlineOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'code':
      return <CodeOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'book':
      return <AutoStoriesOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'image':
      return <CollectionsOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'video':
      return <VideocamOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'music':
      return <MusicNoteOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'link':
      return <LinkOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'lightbulb':
      return <LightbulbOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'school':
      return <SchoolOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
    case 'folder':
    default:
      return <FolderOutlinedIcon fontSize={fontSize} sx={mergedSx} {...props} />;
  }
}
