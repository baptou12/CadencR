/**
 * Parse user answers from a multi-question response string.
 * Each question's answer is in a section separated by double newlines,
 * with the format "Answer: <answer text>".
 */
export function parseQuestionAnswers(
  questions: Array<{ question: string }>,
  response: string,
): Record<string, string> {
  const answers: Record<string, string> = {};
  const sections = response.split("\n\n");
  questions.forEach((q, index) => {
    const section = sections[index];
    if (section) {
      const answerMatch = section.match(/Answer:\s*(.+)/s);
      if (answerMatch) {
        answers[q.question] = answerMatch[1].trim();
      }
    }
  });
  return answers;
}
