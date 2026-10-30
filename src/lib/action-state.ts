/** Shape returned by server actions to forms (client-safe type). */
export type ActionState<T = undefined> = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Echo of submitted values so forms can keep input after a failed submit. */
  values?: Record<string, string>;
  data?: T;
};
