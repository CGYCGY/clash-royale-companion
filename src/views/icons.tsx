// Inline so there is no icon library or CDN; stroke uses currentColor to follow the surrounding text colour.
const svgProps = {
  viewBox: "0 0 24 24",
  width: "20",
  height: "20",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
  focusable: "false",
} as const;

export const EyeIcon = () => (
  <svg {...svgProps} class="icon-eye">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOffIcon = () => (
  <svg {...svgProps} class="icon-eye-off">
    <path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9" />
    <path d="M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="M3 3l18 18" />
  </svg>
);

export const CopyIcon = () => (
  <svg {...svgProps} class="icon-copy">
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...svgProps} class="icon-check">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const GearIcon = () => (
  <svg {...svgProps} class="icon-gear">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const LogOutIcon = () => (
  <svg {...svgProps} class="icon-logout">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export const ChevronDownIcon = () => (
  <svg {...svgProps} class="icon-chevron" width="16" height="16">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...svgProps} class="icon-close">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export const ArrowLeftIcon = () => (
  <svg {...svgProps} class="icon-arrow-left" width="16" height="16">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

// lucide "refresh-cw"
export const RefreshIcon = () => (
  <svg {...svgProps} class="icon-refresh">
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

export const SortAscIcon = () => (
  <svg {...svgProps} class="icon-sort" width="16" height="16">
    <path d="M3 8l4-4 4 4M7 4v16M13 12h8M13 16h5M13 20h2" />
  </svg>
);

export const SortDescIcon = () => (
  <svg {...svgProps} class="icon-sort" width="16" height="16">
    <path d="M3 16l4 4 4-4M7 20V4M13 4h8M13 8h5M13 12h2" />
  </svg>
);
