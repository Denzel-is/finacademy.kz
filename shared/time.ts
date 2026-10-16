// Convert a datetime-local value in the organization's zone, not the browser's.
export function organizationInstant(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Укажите корректные дату и время.");
  const target = Date.parse(value + ':00Z');
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0,16) !== value)
    throw new Error("Укажите корректные дату и время.");
  const format = new Intl.DateTimeFormat('en-CA', {timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const wall = (instant: number) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`;
  };
  let instant = target;
  for (let i=0;i<3;i++) instant += target-Date.parse(wall(instant));
  if (wall(instant).slice(0,16) !== value) throw new Error("Это время недоступно в выбранном часовом поясе.");
  return new Date(instant).toISOString();
}
