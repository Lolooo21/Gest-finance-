import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.issues.map((i) => i.message));
    }
    return result.data;
  }
}
