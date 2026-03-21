export function mergeLocks(local: any[], remote: any[]) {
  const map = new Map();

  [...local, ...remote].forEach((l) => {
    map.set(l.file, l); 
  });

  return Array.from(map.values());
}