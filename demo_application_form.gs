function createVoiceAIDemoForm() {
  const form = FormApp.create("VoiceAI Demo - Software Engineer Application");

  form.setDescription(
    "A short demo application for VoiceAI.\n\n" +
    "Four fields can be drafted from the applicant's resume. " +
    "The remaining questions are collected by the voice agent."
  );

  // Resume-filled fields
  form.addTextItem()
    .setTitle("Full name")
    .setRequired(true);

  const emailItem = form.addTextItem()
    .setTitle("Email address")
    .setRequired(true);

  emailItem.setValidation(
    FormApp.createTextValidation()
      .requireTextIsEmail()
      .setHelpText("Enter a valid email address.")
      .build()
  );

  form.addCheckboxItem()
    .setTitle("Which technical skills do you have?")
    .setChoiceValues([
      "Python",
      "JavaScript / TypeScript",
      "Node.js",
      "React",
      "SQL",
      "PostgreSQL",
      "Git / GitHub",
      "Docker"
    ])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle("Describe one relevant project or work experience.")
    .setRequired(true);

  // Voice-agent fields
  form.addParagraphTextItem()
    .setTitle("Why are you interested in this position?")
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle("When can you start?")
    .setChoiceValues([
      "Immediately",
      "Within 15 days",
      "Within 30 days",
      "More than 30 days"
    ])
    .setRequired(true);

  Logger.log("=== VOICEAI DEMO FORM CREATED ===");
  Logger.log("Edit URL: " + form.getEditUrl());
  Logger.log("Published URL: " + form.getPublishedUrl());
}
