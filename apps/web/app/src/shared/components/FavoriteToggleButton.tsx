import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { MouseEvent } from 'react';

export interface FavoriteToggleButtonProps {
  favorite: boolean;
  onToggle: () => void;
  disabled?: boolean;
  itemLabel?: string;
  size?: 'small' | 'medium';
}

export function FavoriteToggleButton({
  favorite,
  onToggle,
  disabled = false,
  itemLabel,
  size = 'small',
}: FavoriteToggleButtonProps) {
  const baseLabel = favorite ? 'Remove from favorites' : 'Add to favorites';
  const ariaLabel = itemLabel ? `${baseLabel}: ${itemLabel}` : baseLabel;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggle();
  };

  return (
    <Tooltip title={baseLabel}>
      <IconButton
        size={size}
        onClick={handleClick}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={favorite}
        color={favorite ? 'warning' : 'default'}
      >
        {favorite ? <StarIcon fontSize={size} /> : <StarBorderIcon fontSize={size} />}
      </IconButton>
    </Tooltip>
  );
}
