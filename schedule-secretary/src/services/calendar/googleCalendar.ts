import { google, calendar_v3 } from "googleapis";
import { config } from "../../config";

export interface CalendarEventInput {
  calendarId: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM
  endTime: string | null; // HH:MM
  allDay: boolean;
  colorId?: string;
  reminders: { dayBeforeHour: number; minutesBefore: number };
  defaultEventHours: number;
}

export interface CalendarRegisterResult {
  googleEventId: string;
  htmlLink: string | null;
  startAt: Date;
  endAt: Date | null;
}

/**
 * 「前日18時」をGoogleの「開始N分前」形式へ変換する。
 * 例: 開始9:00 → 前日18:00 は開始の15時間前 = 900分前。
 */
export function dayBeforeMinutes(startAt: Date, dayBeforeHour: number): number {
  const remind = new Date(startAt);
  remind.setDate(remind.getDate() - 1);
  remind.setHours(dayBeforeHour, 0, 0, 0);
  const minutes = Math.round((startAt.getTime() - remind.getTime()) / 60000);
  // Google Calendar の上限は4週間(40320分)
  return Math.max(0, Math.min(40320, minutes));
}

function buildTimes(input: CalendarEventInput): { startAt: Date; endAt: Date; start: calendar_v3.Schema$EventDateTime; end: calendar_v3.Schema$EventDateTime } {
  if (input.allDay || !input.startTime) {
    const startAt = new Date(`${input.date}T00:00:00`);
    const next = new Date(startAt);
    next.setDate(next.getDate() + 1);
    const nextStr = next.toISOString().slice(0, 10);
    return {
      startAt,
      endAt: next,
      start: { date: input.date },
      end: { date: nextStr },
    };
  }
  const startAt = new Date(`${input.date}T${input.startTime}:00`);
  let endAt: Date;
  if (input.endTime) {
    endAt = new Date(`${input.date}T${input.endTime}:00`);
    if (endAt <= startAt) endAt.setDate(endAt.getDate() + 1); // 夜勤等の日跨ぎ
  } else {
    endAt = new Date(startAt.getTime() + input.defaultEventHours * 3600 * 1000);
  }
  return {
    startAt,
    endAt,
    start: { dateTime: startAt.toISOString(), timeZone: "Asia/Tokyo" },
    end: { dateTime: endAt.toISOString(), timeZone: "Asia/Tokyo" },
  };
}

export interface CalendarService {
  insertEvent(input: CalendarEventInput): Promise<CalendarRegisterResult>;
  updateEvent(calendarId: string, googleEventId: string, input: CalendarEventInput): Promise<CalendarRegisterResult>;
  deleteEvent(calendarId: string, googleEventId: string): Promise<void>;
}

class RealCalendarService implements CalendarService {
  private getClient(): calendar_v3.Calendar {
    if (!config.googleClientId || !config.googleClientSecret || !config.googleRefreshToken) {
      throw new Error("Googleカレンダーの認証情報が設定されていません(GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN)");
    }
    const oauth2 = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret);
    oauth2.setCredentials({ refresh_token: config.googleRefreshToken });
    return google.calendar({ version: "v3", auth: oauth2 });
  }

  private buildBody(input: CalendarEventInput) {
    const t = buildTimes(input);
    const overrides = [
      { method: "popup" as const, minutes: dayBeforeMinutes(t.startAt, input.reminders.dayBeforeHour) },
      { method: "popup" as const, minutes: input.reminders.minutesBefore },
    ];
    return {
      times: t,
      body: {
        summary: input.title,
        description: input.description,
        start: t.start,
        end: t.end,
        colorId: input.colorId,
        reminders: { useDefault: false, overrides },
      } as calendar_v3.Schema$Event,
    };
  }

  async insertEvent(input: CalendarEventInput): Promise<CalendarRegisterResult> {
    const { times, body } = this.buildBody(input);
    const res = await this.getClient().events.insert({ calendarId: input.calendarId, requestBody: body });
    return {
      googleEventId: res.data.id!,
      htmlLink: res.data.htmlLink ?? null,
      startAt: times.startAt,
      endAt: times.endAt,
    };
  }

  async updateEvent(calendarId: string, googleEventId: string, input: CalendarEventInput): Promise<CalendarRegisterResult> {
    const { times, body } = this.buildBody(input);
    const res = await this.getClient().events.patch({ calendarId, eventId: googleEventId, requestBody: body });
    return {
      googleEventId: res.data.id!,
      htmlLink: res.data.htmlLink ?? null,
      startAt: times.startAt,
      endAt: times.endAt,
    };
  }

  async deleteEvent(calendarId: string, googleEventId: string): Promise<void> {
    await this.getClient().events.delete({ calendarId, eventId: googleEventId });
  }
}

/** 開発用: 実際のGoogleカレンダーを呼ばずに成功を返す */
class MockCalendarService implements CalendarService {
  async insertEvent(input: CalendarEventInput): Promise<CalendarRegisterResult> {
    const t = buildTimes(input);
    const id = `mock-${Math.abs(hash(`${input.title}${input.date}${input.startTime}`))}`;
    console.log(`[calendar:mock] insert: ${input.title} @ ${input.date} ${input.startTime ?? "(終日)"}`);
    return { googleEventId: id, htmlLink: null, startAt: t.startAt, endAt: t.endAt };
  }
  async updateEvent(_c: string, googleEventId: string, input: CalendarEventInput): Promise<CalendarRegisterResult> {
    const t = buildTimes(input);
    console.log(`[calendar:mock] update: ${googleEventId}`);
    return { googleEventId, htmlLink: null, startAt: t.startAt, endAt: t.endAt };
  }
  async deleteEvent(_c: string, googleEventId: string): Promise<void> {
    console.log(`[calendar:mock] delete: ${googleEventId}`);
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function getCalendarService(): CalendarService {
  return config.calendarMode === "mock" ? new MockCalendarService() : new RealCalendarService();
}
