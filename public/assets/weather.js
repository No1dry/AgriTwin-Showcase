/* Public regional weather; all periods end at noon in Asia/Shanghai. */
const WeatherSeries = (() => {
  'use strict';
  const HOUR = 3600, DAY = 24 * HOUR, OFFSET = 8 * HOUR;
  const fields = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'precipitation'];
  const units = ['°C', '%', 'km/h', 'mm'];
  const bounds = [[-90, 65], [0, 100], [0, 500], [0, 1000]];
  const finite = v => typeof v === 'number' && Number.isFinite(v);

  function windowAt(now = Date.now()) {
    if (!finite(now)) throw Error('WEATHER_CLOCK');
    const seconds = Math.floor(now / 1000);
    let end = Math.floor((seconds + OFFSET) / DAY) * DAY - OFFSET + 12 * HOUR;
    if (end > seconds) end -= DAY;
    return { start: end - DAY, end };
  }

  function parse(raw) {
    if (raw?.utc_offset_seconds !== OFFSET || !finite(raw.latitude) || !finite(raw.longitude) || Math.abs(raw.latitude - 30.1417) > .3 || Math.abs(raw.longitude - 114.625) > .3) throw Error('WEATHER_REGION');
    const hours = raw.hourly, times = hours?.time;
    if (!Array.isArray(times) || times.length < 24 || times.length > 300) throw Error('WEATHER_HOURS');
    fields.forEach((field, i) => {
      if (raw.hourly_units?.[field] !== units[i] || !Array.isArray(hours[field]) || hours[field].length !== times.length) throw Error('WEATHER_UNITS_OR_LENGTH');
    });
    return times.map((time, index) => {
      if (!Number.isSafeInteger(time) || time % HOUR !== 0 || (index > 0 && time <= times[index - 1])) throw Error('WEATHER_TIME');
      const row = { time };
      fields.forEach((field, i) => {
        const value = hours[field][index];
        if (value !== null && (!finite(value) || value < bounds[i][0] || value > bounds[i][1])) throw Error('WEATHER_VALUE');
        row[field] = value;
      });
      return row;
    });
  }

  function summarize(rows, now = Date.now()) {
    const period = windowAt(now), byTime = new Map(rows.map(row => [row.time, row]));
    const days = Array.from({ length: 7 }, (_, index) => {
      const end = period.end - (6 - index) * DAY, start = end - DAY;
      const result = { start, end, count: {} };
      for (const field of fields) {
        const values = Array.from({ length: 24 }, (_, hour) => byTime.get(start + (hour + (field === 'precipitation' ? 1 : 0)) * HOUR)?.[field]).filter(finite);
        result.count[field] = values.length;
        result[field] = values.length === 24 ? values.reduce((sum, value) => sum + value, 0) / (field === 'precipitation' ? 1 : 24) : null;
      }
      return result;
    });
    return { period, days, latest: days.at(-1) };
  }

  function endpoint() {
    return 'https://api.open-meteo.com/v1/forecast?latitude=30.1417&longitude=114.625&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation&past_days=8&forecast_days=1&timezone=Asia%2FShanghai&timeformat=unixtime';
  }

  async function fetchSeries(signal) {
    const response = await fetch(endpoint(), { credentials: 'omit', signal });
    if (!response.ok) throw Error('WEATHER_HTTP');
    const body = await response.text();
    if (body.length > 100000) throw Error('WEATHER_SIZE');
    return parse(JSON.parse(body));
  }
  return Object.freeze({ windowAt, parse, summarize, endpoint, fetchSeries });
})();
