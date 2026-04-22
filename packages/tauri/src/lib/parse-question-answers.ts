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

  // We can't split by \n\n because question text itself may contain double newlines.
  // Instead, locate each question's text, then extract the Answer: line that follows it.
  questions.forEach((q, index) => {
    const qPos = response.indexOf(q.question);
    if (qPos === -1) return;

    // Limit search region to before the next question starts
    const nextQ = questions[index + 1];
    const nextQPos = nextQ ? response.indexOf(nextQ.question, qPos + q.question.length) : -1;
    const region =
      nextQPos === -1
        ? response.substring(qPos + q.question.length)
        : response.substring(qPos + q.question.length, nextQPos);

    const answerMatch = region.match(/\nAnswer:\s*(.+)/s);
    if (answerMatch) {
      answers[q.question] = answerMatch[1].trim();
    }
  });
  return answers;
}
