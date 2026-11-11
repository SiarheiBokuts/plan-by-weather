import { Catch, Logger } from '@nestjs/common';
import { GqlExceptionFilter } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import { ErrorCode } from '../../common/errors';

/**
 * Our typed errors (city not found, bad input, Open-Meteo problems...) are normal answers, not crashes.
 * Without this filter Nest logs each of them as an ERROR with a stack trace, which buries the real
 * problems. This logs them as one short WARN line and returns them unchanged to the client; any
 * other exception still goes to Nest's default handler (ERROR with stack).
 */
@Catch(GraphQLError)
export class GraphQLErrorFilter implements GqlExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(error: GraphQLError): GraphQLError {
    const code = error.extensions?.code;
    // A client over its limit is logged once per window by the rate-limit guard, not once per refusal.
    if (code !== ErrorCode.ClientRateLimited) {
      this.logger.warn(`${String(code)}: ${error.message}`);
    }
    return error;
  }
}
