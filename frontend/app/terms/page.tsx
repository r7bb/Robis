import { DraftLegalPage } from '../../components/legal/draft-page.tsx';

export const metadata = { title: 'Terms (draft) · Robis' };

export default function TermsPage() {
  return (
    <DraftLegalPage title="Terms">
      <p>
        Robis is a portfolio project. It is not offered as a commercial service, and there is no
        agreement here beyond what a lawyer would need to write.
      </p>
      <h2>Who can use it</h2>
      <p>
        Creating an account asks you to confirm you are at least 16. That age is a placeholder
        pending review, and the right threshold depends on where people use the app.
      </p>
      <h2>What you post</h2>
      <p>
        Issues, comments, messages, documents and pictures you add belong to you and the workspace
        you add them to. Workspace owners and admins can remove content in their workspace.
      </p>
      <h2>No guarantees</h2>
      <p>
        The software is provided as it is, without any promise that it is available or fit for a
        purpose.
      </p>
    </DraftLegalPage>
  );
}
