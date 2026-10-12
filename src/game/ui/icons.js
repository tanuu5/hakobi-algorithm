// 道具・ボタンの絵（SVG。線で描く。色は currentColor）
const s = (inner, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const ICONS = {
  select: s('<path d="M5 3 L5 18 L9.2 14.2 L12 20.5 L14.6 19.3 L11.8 13.2 L17.5 13 Z"/>'),
  belt: s('<rect x="2.5" y="7" width="19" height="10" rx="2"/><path d="M7 10 L9.5 12 L7 14 M12 10 L14.5 12 L12 14 M17 10 L19 12 L17 14"/>'),
  sorter: s('<path d="M3 15 H11 M11 15 L20 15 M11 15 C14 15 15 6 20 6"/><path d="M17.5 3.8 L20.3 6 L17.5 8.3 M17.5 12.8 L20.3 15 L17.5 17.3"/><rect x="9" y="11" width="4" height="8" rx="1"/>'),
  junction: s('<path d="M12 2.5 V21.5 M2.5 12 H21.5"/><path d="M9.5 5 L12 2.5 L14.5 5 M19 9.5 L21.5 12 L19 14.5"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>'),
  arm: s('<path d="M4 21 H12"/><path d="M8 21 V17.5"/><circle cx="8" cy="16" r="1.6"/><path d="M8.8 14.7 L13 8.5"/><circle cx="13.6" cy="7.6" r="1.5"/><path d="M15 8 L19.5 11.5"/><path d="M18 13.5 L21 10.5 M19.5 11.5 L20.6 12.6"/>'),
  shelf: s('<path d="M4 3 V21 M20 3 V21 M4 9 H20 M4 15 H20 M4 21 H20"/><rect x="6" y="4.5" width="4" height="4" rx="0.6"/><rect x="11.5" y="10.5" width="5" height="4" rx="0.6"/><rect x="6.5" y="16.5" width="4" height="4" rx="0.6"/>'),
  pad: s('<rect x="2.5" y="13.5" width="19" height="7" rx="1.5"/><path d="M8 9 H16 M12 9 V12"/><circle cx="6" cy="6.5" r="2.4"/><circle cx="18" cy="6.5" r="2.4"/><path d="M8 7.5 L10 9 M16 7.5 L14 9"/>'),
  charger: s('<circle cx="12" cy="12" r="9"/><path d="M13 5.5 L8.5 12.8 H12 L11 18.5 L15.5 11.2 H12 Z" fill="currentColor" stroke="none"/>'),
  robot: s('<circle cx="12" cy="6" r="3.4"/><path d="M10.2 6.2 H13.8"/><path d="M8 21 V15 M16 21 V15 M7 15 V11.5 C7 10.5 8 9.8 9 9.8 H15 C16 9.8 17 10.5 17 11.5 V15 Z"/><path d="M7 11.5 L4.5 15 M17 11.5 L19.5 15"/>'),
  labeler: s('<path d="M3 11 L11 3 H20 V12 L12 20 Z"/><circle cx="15.8" cy="7.2" r="1.6"/><path d="M8 13 L11 16 M10 11 L13 14"/>'),
  remove: s('<path d="M4 7 H20 M9 7 V4.5 H15 V7 M6.5 7 L7.5 20 H16.5 L17.5 7"/><path d="M10 10.5 V16.5 M14 10.5 V16.5"/>'),
  rotate: s('<path d="M19 12 A7 7 0 1 1 15.8 6.1"/><path d="M14.5 2.8 L16.6 6.4 L12.8 7.6"/>'),
  pause: s('<path d="M8.5 5 V19 M15.5 5 V19" stroke-width="2.6"/>'),
  play: s('<path d="M7.5 5 L18.5 12 L7.5 19 Z" fill="currentColor" stroke="none"/>'),
  ff: s('<path d="M3.5 6 L11.5 12 L3.5 18 Z M12.5 6 L20.5 12 L12.5 18 Z" fill="currentColor" stroke="none"/>'),
  fff: s('<path d="M1.5 6.5 L7.5 12 L1.5 17.5 Z M8.5 6.5 L14.5 12 L8.5 17.5 Z M15.5 6.5 L21.5 12 L15.5 17.5 Z" fill="currentColor" stroke="none"/>'),
  menu: s('<path d="M4 7 H20 M4 12 H20 M4 17 H20" stroke-width="2"/>'),
  eye: s('<path d="M2 12 C5 6.5 8.5 4.5 12 4.5 C15.5 4.5 19 6.5 22 12 C19 17.5 15.5 19.5 12 19.5 C8.5 19.5 5 17.5 2 12 Z"/><circle cx="12" cy="12" r="3.3"/><path d="M12 8.7 V12 H15.3"/>'),
  close: s('<path d="M6 6 L18 18 M18 6 L6 18" stroke-width="2"/>'),
  truck: s('<rect x="2" y="6" width="12" height="10" rx="1"/><path d="M14 9 H18.5 L21.5 12.5 V16 H14 Z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
  box: s('<path d="M12 2.8 L20.5 7 V17 L12 21.2 L3.5 17 V7 Z M3.5 7 L12 11.2 L20.5 7 M12 11.2 V21.2"/>'),
  bolt: s('<path d="M13 2.5 L5.5 13 H11 L10 21.5 L18.5 10.5 H13 Z" fill="currentColor" stroke="none"/>'),
  star: s('<path d="M12 2.8 L14.7 8.6 L21 9.3 L16.3 13.6 L17.6 19.9 L12 16.7 L6.4 19.9 L7.7 13.6 L3 9.3 L9.3 8.6 Z" fill="currentColor" stroke="none"/>'),
  boss: s('<circle cx="12" cy="8.5" r="4.2"/><path d="M7.5 6.8 C7.8 3.9 16.2 3.9 16.5 6.8 Z" fill="currentColor"/><path d="M4 21 C4.6 16 8 13.8 12 13.8 C16 13.8 19.4 16 20 21"/>'),
  ai: s('<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M9 2 V4.5 M15 2 V4.5 M9 19.5 V22 M15 19.5 V22 M2 9 H4.5 M2 15 H4.5 M19.5 9 H22 M19.5 15 H22"/><circle cx="12" cy="12" r="2.8" fill="currentColor" stroke="none"/>'),
};

/** 宛先の形（色つき）。 */
export function destIcon(d, color) {
  const shapes = [
    '<circle cx="12" cy="12" r="7"/>',
    '<path d="M12 4.5 L19.5 18 H4.5 Z"/>',
    '<rect x="5.5" y="5.5" width="13" height="13" rx="1"/>',
    '<path d="M12 3.8 L19.5 12 L12 20.2 L4.5 12 Z"/>',
  ];
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="${color}">${shapes[d]}</g></svg>`;
}
