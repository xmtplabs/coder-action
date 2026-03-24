export interface Logger {
  info(message: string): void;
  debug(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

interface LogEntry {
  level: "info" | "debug" | "warning" | "error";
  message: string;
}

export class ConsoleLogger implements Logger {
  info(message: string): void {
    console.log(JSON.stringify({ level: "info", message, timestamp: new Date().toISOString() }));
  }
  debug(message: string): void {
    console.log(JSON.stringify({ level: "debug", message, timestamp: new Date().toISOString() }));
  }
  warning(message: string): void {
    console.warn(JSON.stringify({ level: "warning", message, timestamp: new Date().toISOString() }));
  }
  error(message: string): void {
    console.error(JSON.stringify({ level: "error", message, timestamp: new Date().toISOString() }));
  }
}

export class TestLogger implements Logger {
  messages: LogEntry[] = [];
  info(message: string): void { this.messages.push({ level: "info", message }); }
  debug(message: string): void { this.messages.push({ level: "debug", message }); }
  warning(message: string): void { this.messages.push({ level: "warning", message }); }
  error(message: string): void { this.messages.push({ level: "error", message }); }
  clear(): void { this.messages = []; }
}
