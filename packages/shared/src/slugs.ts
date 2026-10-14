// Readable URL parts: lowercase ASCII words joined by "-". "Paneer Tikka (Half)" → "paneer-tikka-half".
export const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';

// A table's link: its name for people, its code for the lookup ("t4-k7q2"). Only the code
// counts, so a renamed table's printed QR code keeps working.
export const tableSlug = (t: { name: string; code: string }) => `${slugify(t.name)}-${t.code}`;
export const tableCodeOf = (slug: string) => slug.slice(slug.lastIndexOf('-') + 1).toLowerCase();

// The guest menu's address: the outlet's own (menu only) or one table's (can order).
export const guestMenuPath = (customerCode: string, outletCode: string, table?: { name: string; code: string }) =>
  `/m/${customerCode}/${outletCode.toLowerCase()}${table ? `/${tableSlug(table)}` : ''}`;
