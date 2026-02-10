async function main() {
  const r = await fetch('https://bible.helloao.org/api/eng_kjv/MAT/4.json');
  const d = await r.json();
  console.log('Top keys:', Object.keys(d));
  console.log('chapter keys:', Object.keys(d.chapter));
  const v4 = d.chapter.content.find(v => v.type === 'verse' && v.number === 4);
  console.log('Verse 4 full:', JSON.stringify(v4, null, 2));
  const v1 = d.chapter.content.find(v => v.type === 'verse' && v.number === 1);
  console.log('Verse 1 full:', JSON.stringify(v1, null, 2));

  // Test JHN (John) - verify book ID compatibility
  const r2 = await fetch('https://bible.helloao.org/api/eng_kjv/JHN/3.json');
  console.log('JHN status:', r2.status);

  // Test SNG (Song of Solomon)
  const r3 = await fetch('https://bible.helloao.org/api/eng_kjv/SNG/1.json');
  console.log('SNG status:', r3.status);

  // Test Revelation
  const r4 = await fetch('https://bible.helloao.org/api/eng_kjv/REV/1.json');
  console.log('REV status:', r4.status);
}
main().catch(console.error);
