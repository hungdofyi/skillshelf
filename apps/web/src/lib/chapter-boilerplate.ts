/** Front and back matter that rarely holds ideas: skipped by default when picking chapters to summarize. */
const BOILERPLATE = /^(praise|endorsements?|author('s)? bio|about the author|about the authors|also by|acknowledg|copyright|title page|half title|dedication|table of contents|contents|index|colophon|cover|notes|bibliography|permissions|credits|newsletter|more from|other books)/i;

export const isBoilerplateChapter = (title: string): boolean => BOILERPLATE.test(title.trim());
