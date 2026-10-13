import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/assets/weather.js', import.meta.url), 'utf8');
const weather = vm.runInNewContext(`${source}\n; WeatherSeries`, {});
const HOUR = 3600;
const DAY = 24 * HOUR;
const fields = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'precipitation'];
const now = Date.parse('2026-10-13T04:30:00.000Z');
const end = Date.parse('2026-10-13T04:00:00.000Z') / 1000;
const seconds = iso => Date.parse(iso) / 1000;

function rowsThrough(endTime = end, count = 195) {
  const start = endTime - 8 * DAY;
  return Array.from({ length: count }, (_, index) => ({
    time: start + index * HOUR,
    temperature_2m: 20,
    relative_humidity_2m: 60,
    wind_speed_10m: 12,
    precipitation: 1,
  }));
}

function response(rows = rowsThrough()) {
  return {
    latitude: 30.1417,
    longitude: 114.625,
    timezone: 'Asia/Shanghai',
    utc_offset_seconds: 28800,
    hourly_units: { time: 'unixtime', temperature_2m: '°C', relative_humidity_2m: '%', wind_speed_10m: 'km/h', precipitation: 'mm' },
    hourly: {
      time: rows.map(row => row.time),
      ...Object.fromEntries(fields.map(field => [field, rows.map(row => row[field])])),
    },
  };
}

function summarize(rows = rowsThrough(), at = now) {
  return weather.summarize(weather.parse(response(rows)), at);
}

test('Beijing noon boundary selects only the most recently completed 24-hour period', () => {
  const cases = [
    ['2026-10-13T03:59:59.999Z', '2026-10-11T04:00:00Z', '2026-10-12T04:00:00Z'],
    ['2026-10-13T04:00:00.000Z', '2026-10-12T04:00:00Z', '2026-10-13T04:00:00Z'],
    ['2026-10-13T04:00:00.001Z', '2026-10-12T04:00:00Z', '2026-10-13T04:00:00Z'],
    ['2026-10-13T16:00:00.000Z', '2026-10-12T04:00:00Z', '2026-10-13T04:00:00Z'],
  ];
  for (const [clock, start, finish] of cases) {
    const period = weather.windowAt(Date.parse(clock));
    assert.equal(period.start, seconds(start), clock);
    assert.equal(period.end, seconds(finish), clock);
    assert.equal(period.end - period.start, DAY);
  }
});

test('noon periods cross month, leap-day and year boundaries without resetting to midnight', () => {
  for (const [clock, expectedStart] of [
    ['2026-03-01T04:00:00Z', '2026-02-28T04:00:00Z'],
    ['2028-03-01T04:00:00Z', '2028-02-29T04:00:00Z'],
    ['2027-01-01T04:00:00Z', '2026-12-31T04:00:00Z'],
  ]) {
    const period = weather.windowAt(Date.parse(clock));
    assert.equal(period.start, seconds(expectedStart));
    assert.equal(period.end, seconds(clock));
  }
  assert.throws(() => weather.windowAt(Number.NaN), /WEATHER_CLOCK/);
  assert.throws(() => weather.windowAt(Infinity), /WEATHER_CLOCK/);
});

test('summary contains seven complete consecutive noon-to-noon days in ascending order', () => {
  const result = summarize();
  assert.equal(result.days.length, 7);
  assert.equal(result.period.start, end - DAY);
  assert.equal(result.period.end, end);
  for (let index = 0; index < 7; index++) {
    const day = result.days[index];
    assert.equal(day.start, end - (7 - index) * DAY);
    assert.equal(day.end, end - (6 - index) * DAY);
    for (const field of fields) assert.equal(day.count[field], 24);
  }
});

test('before noon, the current incomplete reporting day never enters the seven-day summary', () => {
  const result = summarize(rowsThrough(), Date.parse('2026-10-13T03:59:59Z'));
  assert.equal(result.days.length, 7);
  assert.equal(result.days[0].start, end - 8 * DAY);
  assert.equal(result.days.at(-1).end, end - DAY);
  assert.ok(result.days.every(day => day.end <= end - DAY));
});

test('temperature uses [start,end), while preceding-hour precipitation uses (start,end]', () => {
  const rows = rowsThrough();
  Object.assign(rows.find(row => row.time === end - DAY), { temperature_2m: 44, precipitation: 100 });
  Object.assign(rows.find(row => row.time === end), { temperature_2m: 64, precipitation: 2 });
  const day = summarize(rows).days.at(-1);
  assert.equal(day.temperature_2m, 21);
  assert.equal(day.precipitation, 25);
  assert.equal(day.relative_humidity_2m, 60);
  assert.equal(day.wind_speed_10m, 12);
});

test('latest is the final complete day and excludes future samples at each metric boundary', () => {
  const baseline = summarize();
  const rows = rowsThrough();
  for (const row of rows) {
    if (row.time >= end) {
      row.temperature_2m = 65;
      row.relative_humidity_2m = 100;
      row.wind_speed_10m = 500;
    }
    if (row.time > end) row.precipitation = 1000;
  }
  const result = summarize(rows);
  assert.equal(result.latest, result.days.at(-1));
  assert.equal(JSON.stringify(result.latest), JSON.stringify(baseline.latest));
  assert.equal(JSON.stringify(result.days), JSON.stringify(baseline.days));
});

test('future model values cannot alter completed daily summaries', () => {
  const baseline = summarize().days;
  const rows = rowsThrough();
  for (const row of rows.filter(row => row.time * 1000 > now)) {
    Object.assign(row, { temperature_2m: 65, relative_humidity_2m: 100, wind_speed_10m: 500, precipitation: 1000 });
  }
  assert.equal(JSON.stringify(summarize(rows).days), JSON.stringify(baseline));
});

test('a null hourly value remains missing and makes only that daily metric incomplete', () => {
  const rows = rowsThrough();
  rows.find(row => row.time === end - 3 * HOUR).temperature_2m = null;
  const day = summarize(rows).days.at(-1);
  assert.equal(day.temperature_2m, null);
  assert.equal(day.count.temperature_2m, 23);
  assert.equal(day.relative_humidity_2m, 60);
  assert.equal(day.precipitation, 24);
});

test('missing hours are not interpolated or replaced with zero', () => {
  const rows = rowsThrough().filter(row => row.time !== end - 5 * HOUR);
  const parsed = weather.parse(response(rows));
  assert.equal(parsed.length, rows.length);
  const day = weather.summarize(parsed, now).days.at(-1);
  for (const field of fields) {
    assert.equal(day.count[field], 23);
    assert.equal(day[field], null);
  }
});

test('a missing noon-ending precipitation sample does not invalidate instantaneous averages', () => {
  const rows = rowsThrough();
  rows.find(row => row.time === end).precipitation = null;
  const day = summarize(rows).days.at(-1);
  assert.equal(day.count.precipitation, 23);
  assert.equal(day.precipitation, null);
  assert.equal(day.count.temperature_2m, 24);
  assert.equal(day.temperature_2m, 20);
});

test('real zero values are retained rather than treated as missing', () => {
  const rows = rowsThrough().map(row => ({ ...row, temperature_2m: 0, relative_humidity_2m: 0, wind_speed_10m: 0, precipitation: 0 }));
  const day = summarize(rows).days.at(-1);
  for (const field of fields) {
    assert.equal(day.count[field], 24);
    assert.equal(day[field], 0);
  }
});

test('parser rejects wrong region, timezone offset, units and mismatched array lengths', () => {
  for (const field of ['latitude', 'longitude']) {
    const raw = response(); raw[field] += 1;
    assert.throws(() => weather.parse(raw), /WEATHER_REGION/);
  }
  const wrongOffset = response(); wrongOffset.utc_offset_seconds = 0;
  assert.throws(() => weather.parse(wrongOffset));
  for (const [field, badUnit] of [['temperature_2m', '°F'], ['relative_humidity_2m', 'fraction'], ['wind_speed_10m', 'm/s'], ['precipitation', 'inch']]) {
    const raw = response(); raw.hourly_units[field] = badUnit;
    assert.throws(() => weather.parse(raw), /WEATHER_UNITS_OR_LENGTH/);
  }
  const shortValues = response(); shortValues.hourly.precipitation.pop();
  assert.throws(() => weather.parse(shortValues), /WEATHER_UNITS_OR_LENGTH/);
});

test('parser accepts null but rejects nonfinite, textual and out-of-range weather values', () => {
  for (const [field, invalid] of [
    ['temperature_2m', -91], ['temperature_2m', 66], ['temperature_2m', Number.NaN],
    ['relative_humidity_2m', 101], ['wind_speed_10m', -1], ['wind_speed_10m', Infinity],
    ['precipitation', 1001], ['precipitation', '1'], ['precipitation', undefined],
  ]) {
    const raw = response(); raw.hourly[field][0] = invalid;
    assert.throws(() => weather.parse(raw), /WEATHER_VALUE/);
  }
  const withNull = response(); withNull.hourly.temperature_2m[0] = null;
  assert.equal(weather.parse(withNull)[0].temperature_2m, null);
});

test('parser rejects unsorted, duplicate and non-hour timestamps', () => {
  const reversed = response();
  [reversed.hourly.time[0], reversed.hourly.time[1]] = [reversed.hourly.time[1], reversed.hourly.time[0]];
  assert.throws(() => weather.parse(reversed), /WEATHER_TIME/);
  const duplicate = response(); duplicate.hourly.time[1] = duplicate.hourly.time[0];
  assert.throws(() => weather.parse(duplicate), /WEATHER_TIME/);
  const partialHour = response(); partialHour.hourly.time[0] += 1;
  assert.throws(() => weather.parse(partialHour), /WEATHER_TIME/);
});

test('parser enforces the documented bounded hourly payload size', () => {
  assert.throws(() => weather.parse(response(rowsThrough(end, 23))), /WEATHER_HOURS/);
  assert.throws(() => weather.parse(response(rowsThrough(end, 301))), /WEATHER_HOURS/);
  assert.equal(weather.parse(response(rowsThrough(end, 24))).length, 24);
  assert.equal(weather.parse(response(rowsThrough(end, 300))).length, 300);
});
