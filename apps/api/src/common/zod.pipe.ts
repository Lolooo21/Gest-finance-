import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException([...new Set(result.error.issues.map((i) => i.message))]);
    }
    return result.data;
  }
}
