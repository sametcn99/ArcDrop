import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import { useMemo } from 'react';
import { selectSortedTags, useLibraryStore } from '../../stores/libraryStore';
import { SHARED_TAG_STRINGS } from '../strings';

export interface TagAutocompleteInputProps {
  value: string[];
  onChange: (nextTags: string[]) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
}

function normalizeTagList(rawTags: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawTags) {
    const trimmed = raw.trim().replace(/^#+/, '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

export function TagAutocompleteInput({
  value,
  onChange,
  label = SHARED_TAG_STRINGS.autocompleteLabel,
  placeholder = SHARED_TAG_STRINGS.autocompletePlaceholder,
  disabled = false,
  error = false,
  helperText,
}: TagAutocompleteInputProps) {
  const tagsById = useLibraryStore((s) => s.tagsById);

  const options = useMemo(
    () =>
      selectSortedTags({ tagsById } as Parameters<typeof selectSortedTags>[0]).map(
        (tag) => tag.name,
      ),
    [tagsById],
  );

  return (
    <Autocomplete
      multiple
      freeSolo
      options={options}
      value={value}
      disabled={disabled}
      onChange={(_event, nextValue) => {
        const stringValues = nextValue.map((entry) => String(entry));
        onChange(normalizeTagList(stringValues));
      }}
      renderValue={(selected, getTagProps) =>
        selected.map((option, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return <Chip key={key} size="small" label={`#${option}`} {...tagProps} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          error={error}
          helperText={helperText}
        />
      )}
    />
  );
}
