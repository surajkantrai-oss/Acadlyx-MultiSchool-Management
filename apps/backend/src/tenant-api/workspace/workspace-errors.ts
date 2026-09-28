import { BadRequestException, NotFoundException } from '@nestjs/common';

/** Safe, stable error codes for the Phase 6 workspace read models. */
export const WORKSPACE_ERRORS = {
  contextNotFound: () =>
    new NotFoundException({
      code: 'CONTEXT_NOT_FOUND',
      message: 'That branch or academic year does not exist in this school',
    }),
  classNotFound: () =>
    new NotFoundException({ code: 'CLASS_NOT_FOUND', message: 'Class not found' }),
  searchTooShort: (min: number) =>
    new BadRequestException({
      code: 'SEARCH_TOO_SHORT',
      message: `Type at least ${String(min)} characters to search`,
    }),
};
