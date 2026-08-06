import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 は async ハンドラ内の例外を捕捉しないため、
 * ここで捕捉してエラーミドルウェアへ渡す(プロセスを落とさない)。
 */
export function ah(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
