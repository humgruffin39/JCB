const HORSE_NUMBER_EMOJIS: Readonly<Record<number, string>> = {
  1: '<:horse_1:1539913567787159653>',
  2: '<:horse_2:1539913568982536253>',
  3: '<:horse_3:1539913570123255808>',
  4: '<:horse_4:1539913571339731024>',
  5: '<:horse_5:1539913573206069268>',
  6: '<:horse_6:1539913574695051274>',
  7: '<:horse_7:1539913576037490748>',
  8: '<:horse_8:1539913577345851412>',
};

export function horseNumberEmoji(horseNumber: number): string {
  const emoji = HORSE_NUMBER_EMOJIS[horseNumber];
  if (emoji === undefined) throw new Error(`Unsupported horse number: ${String(horseNumber)}`);
  return emoji;
}
