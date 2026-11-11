/** Where the data in a response came from. Member names equal values: GraphQL exposes the names. */
export enum DataSource {
  /** Open-Meteo was called while serving this request */
  OPEN_METEO = 'OPEN_METEO',
  /** Served from our own database, no Open-Meteo call was made */
  DATABASE = 'DATABASE',
}
