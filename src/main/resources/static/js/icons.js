'use strict';

/* Inline SVG icons (stroke style). Emojis render inconsistently in embedded WebViews, so the UI uses these.
   Categories may still store a plain emoji: EMOJI_TO_ICON maps the known ones and anything else is shown as text. */
const ICONS = {
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h2"/>',
    home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
    receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    settings: '<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    'wifi-off': '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.9a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>',
    package: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
    'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
    'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    trending: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 4 13c0-6 6-9 16-9 0 10-3 16-9 16zM4 21c3-6 6-9 11-12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    pencil: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16v4M17 18h4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    tag: '<path d="M3 12V3h9l9 9-9 9zM7.5 7.5h.01"/>',
    utensils: '<path d="M5 3v7a2 2 0 0 0 2 2v9M9 3v7a2 2 0 0 1-2 2M17 21V3c-2.5 1-4 4-4 8h4"/>',
    cart: '<path d="M3 4h2l2.4 11h10.2L20 7H6M9 20h.01M17 20h.01"/>',
    bus: '<path d="M5 3h14a1 1 0 0 1 1 1v12H4V4a1 1 0 0 1 1-1zM4 11h16M4 16v3h3v-3M17 16v3h3v-3M8 7h.01M16 7h.01"/>',
    pill: '<path d="M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7zM8.5 8.5l7 7"/>',
    gamepad: '<path d="M6 8h12a4 4 0 0 1 4 4v2a3 3 0 0 1-5.2 2l-1.3-1.5h-7L7.2 16A3 3 0 0 1 2 14v-2a4 4 0 0 1 4-4zM7 11v3M5.5 12.5h3M16 12h.01M18 14h.01"/>',
    book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5zM4 19.5V4.5M8 7h8"/>',
    tv: '<path d="M4 6h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM8 2l4 4 4-4"/>',
    cash: '<path d="M2 7h20v10H2zM6 12h.01M18 12h.01"/><circle cx="12" cy="12" r="2.5"/>',
    bank: '<path d="M12 3l9 5H3zM5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/>',
    'credit-card': '<path d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM2 10h20M6 15h4"/>',
    repeat: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
    coins: '<path d="M12 3c4 0 7 1.3 7 3s-3 3-7 3-7-1.3-7-3 3-3 7-3zM5 6v6c0 1.7 3 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3 3 7 3s7-1.3 7-3v-6"/>',
    gift: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
    calendar: '<path d="M4 5h16a1 1 0 0 1 1 1v14H3V6a1 1 0 0 1 1-1zM3 10h18M8 3v4M16 3v4"/>',
    transfer: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
    'chevron-right': '<path d="M9 6l6 6-6 6"/>',
    'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5M4 21h16"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9zM10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    paperclip: '<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4l8.4-8.4"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6"/>',
    // more icons for categories (U8)
    paw: '<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="17" cy="9" r="2"/><path d="M12 12c-3 0-5 3-5 5.5 0 1.5 1.5 2.5 3 1.8l2-.8 2 .8c1.5.7 3-.3 3-1.8 0-2.5-2-5.5-5-5.5z"/>',
    plane: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    shirt: '<path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z"/>',
    car: '<path d="M3 16h18v-4l-2.5-5h-13L3 12zM6 19v-3M18 19v-3M5.5 12h13"/>',
    fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h12M15 9l3-2 2 2v8a1.5 1.5 0 0 1-3 0v-1h-2"/>',
    stethoscope: '<path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>',
    school: '<path d="M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
    dumbbell: '<path d="M6 6v12M18 6v12M3 9v6M21 9v6M6 12h12"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    camera: '<path d="M3 8h4l2-3h6l2 3h4v11H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>',
    heart: '<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8.5L20 20M8.5 15.5L20 4"/>',
    landmark: '<path d="M3 21h18M5 21V10M10 21V10M14 21V10M19 21V10M2 10l10-7 10 7z"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0 5.4 5.4L11 21a2.1 2.1 0 0 1-3-3L14.7 6.3z"/>',
    plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
    coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M7 2v3M11 2v3M15 2v3"/>',
    'shopping-bag': '<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
    droplet: '<path d="M12 2.5S5 10 5 15a7 7 0 0 0 14 0c0-5-7-12.5-7-12.5z"/>',
    flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-3-2 2-3 4-3 7a6 6 0 0 0 6 6z"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
};

const EMOJI_TO_ICON = {
    '💸': 'wallet', '🏠': 'home', '🧾': 'receipt', '🎯': 'target', '⚙': 'settings', '☀': 'sun', '🌙': 'moon',
    '📡': 'wifi-off', '📦': 'package', '⬆': 'arrow-up', '⬇': 'arrow-down', '📈': 'trending', '🧱': 'layers',
    '🍃': 'leaf', '🔎': 'search', '✎': 'pencil', '✨': 'sparkles', '🗑': 'trash', '➖': 'minus', '🏷': 'tag',
    '🍽': 'utensils', '🛒': 'cart', '🚌': 'bus', '💊': 'pill', '🎮': 'gamepad', '📚': 'book', '📺': 'tv', '💰': 'cash'
};

/** Category icons the user can pick from (stored by key). */
const PICKABLE_ICONS = ['utensils', 'cart', 'home', 'bus', 'pill', 'gamepad', 'book', 'tv', 'trending', 'cash',
    'package', 'tag', 'receipt', 'target', 'wallet', 'leaf', 'sparkles', 'gift', 'paw', 'plane', 'shirt', 'car', 'fuel',
    'stethoscope', 'school', 'dumbbell', 'music', 'camera', 'heart', 'scissors', 'landmark', 'wrench', 'plug', 'phone',
    'wifi', 'briefcase', 'coffee', 'shopping-bag', 'droplet', 'flame', 'film'];

function iconKey(value) {
    const raw = String(value ?? '').trim();
    if (ICONS[raw]) return raw;
    return EMOJI_TO_ICON[raw.replace(/[️‍]/g, '')] || null;
}

/** SVG for a known icon key or emoji; unknown text (a custom emoji) is shown as-is. */
function ico(value) {
    const key = iconKey(value);
    if (!key) return String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[key]}</svg>`;
}
