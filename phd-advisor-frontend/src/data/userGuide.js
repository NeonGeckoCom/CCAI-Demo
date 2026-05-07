// User Guide content. Content can be overridden per-application by replacing
// these strings with values pulled from the backend config in the future.
// Use {{appName}} as a placeholder. It gets replaced at render time.

export const userGuideTopics = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'Sparkles',
    content: `# Welcome to {{appName}}

{{appName}} is your AI-powered academic guidance system. A panel of specialized AI advisors gives you diverse perspectives on your research, writing, methodology, and more.

## Your first steps
1. **Start a new chat** using the pencil icon next to the search bar
2. **Type a question.** Anything about your research, methodology, or PhD journey
3. **Read multiple advisor responses.** Each persona brings a different lens
4. **Reply to a specific advisor** to dig deeper into their perspective

## Need help?
You can return to this guide anytime by clicking the **?** icon in the header.`,
  },
  {
    id: 'advisors',
    title: 'Your Advisors',
    icon: 'GraduationCap',
    content: `# Your Advisors

{{appName}} comes with {{advisorCount}} specialized advisor personas. Each one is tuned with a different perspective and area of expertise.

## Available advisors
{{advisorList}}

## Seeing who's available
Click the **"X Advisors"** dropdown in the top right of the chat to see all of your advisors and their current status.`,
  },
  {
    id: 'conversations',
    title: 'Conversations & Replies',
    icon: 'MessageCircle',
    content: `# Conversations & Replies

## Asking a question
Type into the chat box at the bottom. All advisors will respond with their unique perspective.

## Replying to a specific advisor
Click on any advisor's response to **reply directly to them**. This continues the conversation with just that persona, letting you go deeper on their specific angle.

## Expanding a response
Some responses include an **"Expand"** action to ask the advisor to elaborate further with more detail.

## Tips
- Be specific. The more context, the better the advice
- Ask follow-up questions to refine the response
- Different advisors will sometimes disagree, and that's a feature, not a bug`,
  },
  {
    id: 'documents',
    title: 'Uploading Documents',
    icon: 'Paperclip',
    content: `# Uploading Documents

You can attach **PDFs, Word documents, and text files** to give your advisors context.

## How it works
1. Click the paperclip icon in the chat input
2. Select your file
3. Wait for it to process
4. Ask a question, and your advisors will reference the document

## What can it handle?
- Research papers (PDF)
- Drafts and chapters (DOCX, TXT)
- Notes and outlines

## Behind the scenes
Documents are processed using **RAG (retrieval-augmented generation)**. The system finds the most relevant chunks of your document for each question, so even long documents work well.`,
  },
  {
    id: 'sessions',
    title: 'Sessions & History',
    icon: 'MessagesSquare',
    content: `# Sessions & History

Every conversation is automatically saved as a session.

## Finding past chats
Use the **search bar** in the sidebar to filter your past sessions by title.

## Switching between sessions
Click any session in the sidebar to return to it. Your full context is preserved.

## Starting a new chat
Click the pencil/edit icon next to the search bar to start a fresh conversation.

## Renaming or deleting
Hover any session to reveal the **menu**. From there you can rename or delete.`,
  },
  {
    id: 'canvas',
    title: 'Progress Canvas',
    icon: 'BarChart3',
    content: `# {{appName}} Canvas

The Canvas is a **structured dashboard view** of your PhD journey. It pulls insights from your conversations and organizes them into 10 sections:

- Research Progress
- Methodology
- Theoretical Framework
- Challenges & Obstacles
- Next Steps
- Writing & Communication
- Career Development
- Literature Review
- Data Analysis
- Motivation & Mindset

## Accessing the Canvas
Click the **{{appName}} Canvas** button in the sidebar.

## Exporting
You can print or download the Canvas as a snapshot of your progress.`,
  },
  {
    id: 'tips',
    title: 'Tips & Shortcuts',
    icon: 'Sparkles',
    content: `# Tips & Shortcuts

## Get better answers
- **Provide context.** Mention your field, your stage, your specific concern.
- **Quote your work.** Paste a paragraph from your draft for targeted feedback.
- **Use multiple advisors.** Ask one for theory, another for practical next steps.

## Useful workflows
- **Stuck on methodology?** Ask the Methodologist + Theorist together.
- **Feeling burnt out?** The Motivational Coach + Empathetic Listener help reframe.
- **Need to be challenged?** Talk to the Constructive Critic and Socratic Mentor.

## Theme
Switch between light and dark mode using the toggle in the top right.`,
  },
];
