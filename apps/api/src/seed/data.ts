import { TIME_ZONE, type DietType } from '@fnb/shared';

// SAMPLE DATA ONLY. Every name, price, cost and licence number below is made up for trying the
// system out. Nothing here is a real price, a real vendor or a real licence.

export const DEMO = { code: 'demo', password: 'Demo@1234' };

// [name, department, base unit, ₹ per base unit, purchase unit, factor, par per outlet, perishable]
type StockRow = [string, 'food' | 'beverage', 'g' | 'ml' | 'pc', string, string, string, number, boolean];
export const FOOD: StockRow[] = [
  ['Tomato', 'food', 'g', '0.020', 'kg', '1000', 10000, true],
  ['Onion', 'food', 'g', '0.030', 'kg', '1000', 15000, true],
  ['Potato', 'food', 'g', '0.025', 'kg', '1000', 10000, true],
  ['Sweet corn', 'food', 'g', '0.080', 'kg', '1000', 4000, true],
  ['Paneer', 'food', 'g', '0.360', 'kg', '1000', 5000, true],
  ['Chicken boneless', 'food', 'g', '0.280', 'kg', '1000', 10000, true],
  ['Eggs', 'food', 'pc', '6.00', 'tray of 30', '30', 90, true],
  ['Milk', 'food', 'ml', '0.056', 'litre', '1000', 10000, true],
  ['Fresh cream', 'food', 'ml', '0.220', 'litre', '1000', 4000, true],
  ['Butter', 'food', 'g', '0.520', '500 g pack', '500', 3000, true],
  ['Cooking oil', 'food', 'ml', '0.150', '15 litre tin', '15000', 15000, false],
  ['Basmati rice', 'food', 'g', '0.110', '25 kg bag', '25000', 25000, false],
  ['Maida', 'food', 'g', '0.045', '25 kg bag', '25000', 25000, false],
  ['Ginger garlic paste', 'food', 'g', '0.120', 'kg', '1000', 2000, true],
  ['Mixed spices', 'food', 'g', '0.600', 'kg', '1000', 2000, false],
  ['Capsicum', 'food', 'g', '0.060', 'kg', '1000', 3000, true],
  ['Lemon', 'food', 'pc', '4.00', 'dozen', '12', 120, true],
  ['Mint leaves', 'food', 'g', '0.200', 'kg', '1000', 1000, true],
  ['Sugar', 'food', 'g', '0.045', 'kg', '1000', 10000, false],
  ['Vanilla ice cream', 'food', 'ml', '0.250', '4 litre tub', '4000', 8000, true],
  ['Dark chocolate', 'food', 'g', '0.700', 'kg', '1000', 2000, false],
  ['Soda water', 'beverage', 'ml', '0.040', 'crate of 24 x 300 ml', '7200', 14400, false],
  ['Cola', 'beverage', 'ml', '0.060', 'crate of 24 x 300 ml', '7200', 14400, false],
];

// [product name, type, sub-type, brand, bottle ml, abv %, origin, tier, ₹ per ml, par bottles]
type LiquorRow = [string, string, string | null, string, number, string, 'indian' | 'imported', string, string, number];
export const LIQUOR: LiquorRow[] = [
  ['Royal Stag 750 ml', 'Whisky', 'Indian', 'Royal Stag', 750, '42.8', 'indian', 'standard', '1.20', 12],
  ['Blenders Pride 750 ml', 'Whisky', 'Indian', 'Blenders Pride', 750, '42.8', 'indian', 'premium', '1.60', 8],
  ['Johnnie Walker Black Label 750 ml', 'Whisky', 'Blended Scotch', 'Johnnie Walker', 750, '40', 'imported', 'luxury', '4.40', 4],
  ['Glenfiddich 12 750 ml', 'Whisky', 'Single malt', 'Glenfiddich', 750, '40', 'imported', 'luxury', '6.00', 3],
  ['Old Monk 750 ml', 'Rum', 'Dark', 'Old Monk', 750, '42.8', 'indian', 'economy', '0.70', 10],
  ['Bacardi Carta Blanca 750 ml', 'Rum', 'White', 'Bacardi', 750, '37.5', 'indian', 'standard', '1.30', 8],
  ['Smirnoff 750 ml', 'Vodka', 'Plain', 'Smirnoff', 750, '37.5', 'indian', 'standard', '1.10', 8],
  ['Bombay Sapphire 750 ml', 'Gin', 'London dry', 'Bombay Sapphire', 750, '40', 'imported', 'premium', '3.20', 4],
  ['Kingfisher Premium 650 ml', 'Beer', 'Lager', 'Kingfisher', 650, '4.8', 'indian', 'economy', '0.25', 48],
  ['Sula Shiraz 750 ml', 'Wine', 'Red', 'Sula', 750, '13', 'indian', 'standard', '1.10', 6],
];

// [menu item, course, diet, price, recipe [stock item, qty]]
type FoodMenu = [string, string, DietType, string, [string, number][], string[]?, string[]?];
export const FOOD_MENU: FoodMenu[] = [
  ['Tomato Soup', 'Soups and salads', 'veg', '160', [['Tomato', 250], ['Onion', 50], ['Butter', 20], ['Fresh cream', 75], ['Mixed spices', 5], ['Sugar', 10], ['Ginger garlic paste', 10]], ['milk'], ['cuisine:Continental']],
  ['Sweet Corn Soup', 'Soups and salads', 'veg', '160', [['Sweet corn', 200], ['Butter', 15], ['Fresh cream', 50], ['Mixed spices', 5], ['Maida', 20], ['Onion', 30], ['Sugar', 10], ['Ginger garlic paste', 10]], ['milk', 'gluten'], ['cuisine:Chinese']],
  ['Paneer Tikka', 'Starters', 'veg', '280', [['Paneer', 200], ['Capsicum', 50], ['Onion', 50], ['Mixed spices', 10], ['Cooking oil', 20], ['Lemon', 0.5]], ['milk'], ['cuisine:North Indian', 'spice:medium']],
  ['Crispy Corn Pepper', 'Starters', 'veg', '240', [['Sweet corn', 180], ['Capsicum', 40], ['Onion', 40], ['Cooking oil', 40], ['Mixed spices', 5]], [], ['cuisine:Chinese', 'spice:medium']],
  ['Chicken 65', 'Starters', 'non_veg', '300', [['Chicken boneless', 200], ['Ginger garlic paste', 15], ['Mixed spices', 10], ['Cooking oil', 60], ['Eggs', 0.5]], ['egg'], ['cuisine:South Indian', 'spice:hot', "chef's special"]],
  ['Murgh Malai Tikka', 'Starters', 'non_veg', '340', [['Chicken boneless', 220], ['Fresh cream', 50], ['Ginger garlic paste', 15], ['Mixed spices', 8], ['Lemon', 0.5]], ['milk'], ['cuisine:North Indian', 'spice:mild']],
  ['Masala Omelette', 'Appetizers', 'egg', '120', [['Eggs', 3], ['Onion', 30], ['Cooking oil', 10], ['Mixed spices', 3]], ['egg'], []],
  ['Potato Wedges', 'Appetizers', 'veg', '180', [['Potato', 250], ['Cooking oil', 80], ['Mixed spices', 5]], [], ['jain']],
  ['Butter Chicken', 'Main course', 'non_veg', '380', [['Chicken boneless', 250], ['Butter', 30], ['Fresh cream', 60], ['Tomato', 150], ['Mixed spices', 10], ['Ginger garlic paste', 15]], ['milk'], ['cuisine:North Indian', "chef's special"]],
  ['Dal Makhani', 'Main course', 'veg', '290', [['Butter', 40], ['Fresh cream', 50], ['Tomato', 100], ['Mixed spices', 8], ['Ginger garlic paste', 10]], ['milk'], ['cuisine:North Indian']],
  ['Paneer Butter Masala', 'Main course', 'veg', '320', [['Paneer', 200], ['Butter', 30], ['Fresh cream', 50], ['Tomato', 150], ['Mixed spices', 10]], ['milk'], ['cuisine:North Indian']],
  ['Veg Biryani', 'Breads and rice', 'veg', '260', [['Basmati rice', 180], ['Potato', 50], ['Capsicum', 40], ['Onion', 80], ['Cooking oil', 30], ['Mixed spices', 10], ['Mint leaves', 5]], [], ['spice:medium']],
  ['Chicken Biryani', 'Breads and rice', 'non_veg', '340', [['Basmati rice', 180], ['Chicken boneless', 200], ['Onion', 80], ['Cooking oil', 30], ['Mixed spices', 12], ['Mint leaves', 5]], [], ['spice:medium']],
  ['Butter Naan', 'Breads and rice', 'veg', '70', [['Maida', 100], ['Butter', 10], ['Milk', 20]], ['gluten', 'milk'], []],
  ['Garlic Naan', 'Breads and rice', 'veg', '85', [['Maida', 100], ['Butter', 15], ['Milk', 20], ['Ginger garlic paste', 5]], ['gluten', 'milk'], []],
  ['Tandoori Roti', 'Breads and rice', 'veg', '50', [['Maida', 80], ['Butter', 5]], ['gluten'], []],
  ['Jeera Rice', 'Breads and rice', 'veg', '180', [['Basmati rice', 150], ['Butter', 10], ['Mixed spices', 3]], ['milk'], []],
  ['Brownie with Ice Cream', 'Desserts', 'egg', '220', [['Dark chocolate', 60], ['Maida', 30], ['Butter', 30], ['Sugar', 40], ['Eggs', 1], ['Vanilla ice cream', 60]], ['egg', 'gluten', 'milk'], []],
  ['Vanilla Ice Cream', 'Desserts', 'veg', '120', [['Vanilla ice cream', 120]], ['milk'], []],
];

// [menu item, drink type, serve ml, price, recipe]: non-alcoholic beverages, taxed like food.
export const SOFT_MENU: [string, string, number, string, [string, number][]][] = [
  ['Fresh Lime Soda', 'Soft drinks', 300, '110', [['Lemon', 1], ['Soda water', 250], ['Sugar', 20]]],
  ['Virgin Mojito', 'Mocktails', 300, '180', [['Lemon', 1], ['Mint leaves', 10], ['Sugar', 25], ['Soda water', 200]]],
  ['Classic Cold Brew Float', 'Mocktails', 300, '220', [['Sugar', 15], ['Milk', 60], ['Vanilla ice cream', 40]]],
];

// [menu item, product, serve ml, price]; one bottle sells as several items.
export const BAR_MENU: [string, string, number, string][] = [
  ['Royal Stag 30 ml', 'Royal Stag 750 ml', 30, '150'],
  ['Royal Stag 60 ml', 'Royal Stag 750 ml', 60, '280'],
  ['Royal Stag bottle', 'Royal Stag 750 ml', 750, '3200'],
  ['Blenders Pride 30 ml', 'Blenders Pride 750 ml', 30, '190'],
  ['Blenders Pride 60 ml', 'Blenders Pride 750 ml', 60, '340'],
  ['Johnnie Walker Black Label 60 ml', 'Johnnie Walker Black Label 750 ml', 60, '720'],
  ['Johnnie Walker Black Label bottle', 'Johnnie Walker Black Label 750 ml', 750, '8200'],
  ['Glenfiddich 12 60 ml', 'Glenfiddich 12 750 ml', 60, '950'],
  ['Glenfiddich 12 bottle', 'Glenfiddich 12 750 ml', 750, '10500'],
  ['Old Monk 60 ml', 'Old Monk 750 ml', 60, '200'],
  ['Bacardi Carta Blanca 30 ml', 'Bacardi Carta Blanca 750 ml', 30, '150'],
  ['Bacardi Carta Blanca 60 ml', 'Bacardi Carta Blanca 750 ml', 60, '260'],
  ['Smirnoff 60 ml', 'Smirnoff 750 ml', 60, '260'],
  ['Bombay Sapphire 60 ml', 'Bombay Sapphire 750 ml', 60, '520'],
  ['Kingfisher Premium bottle', 'Kingfisher Premium 650 ml', 650, '350'],
  ['Sula Shiraz glass', 'Sula Shiraz 750 ml', 150, '450'],
  ['Sula Shiraz bottle', 'Sula Shiraz 750 ml', 750, '2200'],
];

export const VENDORS: [string, 'food' | 'beverage', string[]][] = [
  ['Green Valley Agro & Fresh Produce Ltd', 'food', ['Tomato', 'Onion', 'Potato', 'Sweet corn', 'Capsicum', 'Lemon', 'Mint leaves', 'Ginger garlic paste']],
  ['Heritage Farms & Dairy Co.', 'food', ['Paneer', 'Chicken boneless', 'Eggs', 'Milk', 'Fresh cream', 'Butter', 'Vanilla ice cream']],
  ['Maharaja Grains & Spices Traders', 'food', ['Cooking oil', 'Basmati rice', 'Maida', 'Mixed spices', 'Sugar', 'Dark chocolate']],
  ['Southern Craft Beverages Ltd', 'beverage', ['Soda water', 'Cola']],
  ['United Spirits & Beverages Distributorship', 'beverage', LIQUOR.map((l) => l[0])],
];

export const STAFF: [string, string, string, string, 'outlet1' | 'all'][] = [
  // [login, name, role, PIN, scope]
  ['manager@demo.test', 'Asha Hegde', 'Outlet manager', '2222', 'outlet1'],
  ['watchman@demo.test', 'Raju Gowda', 'Watchman', '3333', 'outlet1'],
  ['store@demo.test', 'Kiran Kumar', 'Storekeeper / kitchen staff', '4444', 'outlet1'],
  ['chef@demo.test', 'Chef Meera Nambiar', 'Chef / bar manager', '5555', 'outlet1'],
  ['cashier@demo.test', 'Vinay Prasad', 'Cashier', '6666', 'outlet1'],
  ['accounts@demo.test', 'Farah Khan', 'Accounts', '7777', 'all'],
];

// Stock left today, fixed for the demo: at Indiranagar (offers on) Royal Stag is down to four
// 60 ml pegs, so Blenders Pride (priced just above it, plenty in stock) is on offer.
export const LEFT_TODAY: Record<string, Record<string, number>> = {
  BLR1: { 'Royal Stag 750 ml': 240, 'Blenders Pride 750 ml': 4500 },
};

// Repeatable "random" numbers so the sample week is the same every time.
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const istDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(d);
