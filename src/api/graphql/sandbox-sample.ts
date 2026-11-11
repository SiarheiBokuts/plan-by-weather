/**
 * What Apollo Sandbox shows when you open /graphql: one ready-made operation per API query, each
 * selecting every field, so a visitor sees the full shape of each answer and can delete what they
 * do not need. Both share one set of variables. A test compares this document with the real schema,
 * so a field added to the API and not added here fails the tests.
 * The document starts directly with an operation: Sandbox greys out Run while the cursor is outside any
 * operation (for example in a comment line at the top).
 */
export const SANDBOX_DOCUMENT = `query Ranking($city: String!, $countryCode: String) {
  # Rank the next 7 days for one city. Variables: city (required), countryCode (optional, e.g. "US" for Paris, Texas).
  # Every field is selected; remove the ones you do not need. Run runs the operation the cursor is in.
  activityRanking(city: $city, countryCode: $countryCode) {
    location { name country countryCode region latitude longitude elevationM timezone }
    meta { source fetchedAt nextRefreshAt outdated }
    byActivity {
      activity
      available
      unavailableReason
      score
      rating
      bestDay
      bestDays
      days {
        activity date available score rating rank summary reasons unavailableReason
        breakdown { points limitedBy factors { label value mark weight points limit } }
      }
    }
    byDay {
      date
      bestActivity
      weather {
        date condition tempMaxC tempMinC precipitationMm snowfallCm snowDepthCm windMaxKmh waveHeightMaxM
      }
      activities {
        activity date available score rating summary reasons unavailableReason
        breakdown { points limitedBy factors { label value mark weight points limit } }
      }
    }
  }
}

# Find cities by name, best match first (use it to find the right countryCode).
# Variables: query (required), countryCode (optional).
query SearchLocations($query: String!, $countryCode: String) {
  searchLocations(query: $query, countryCode: $countryCode) {
    name country countryCode region latitude longitude elevationM timezone
  }
}
`;

/** Starting values for the variables of both operations. */
export const SANDBOX_VARIABLES = { city: 'Innsbruck', countryCode: null, query: 'Paris' };
