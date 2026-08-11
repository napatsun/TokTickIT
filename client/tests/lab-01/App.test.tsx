import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../../src/App.js";
import * as api from "../../src/api.js";

describe("App", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // WORKED EXAMPLE — provided for you.
  it("renders the TokTickIT heading", () => {
    render(<App />);
    expect(screen.getByText(/TokTickIT/i)).toBeInTheDocument();
  });

  it("shows Online on success", async () => {
    vi.spyOn(api, "checkSystem").mockResolvedValue({
      online: true,
      categories: [],
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /check system/i }));

    await waitFor(() => {
      expect(screen.getByText(/online/i)).toBeInTheDocument();
    });
  });

  it("shows an Offline error message when the API is unavailable", async () => {
    vi.spyOn(api, "checkSystem").mockRejectedValue(
      new Error("Unable to connect to TokTickIT API")
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /check system/i }));

    await waitFor(() => {
      expect(screen.getByText(/offline/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/unable to connect to toktickit api/i)
    ).toBeInTheDocument();
  });
});


// // Issue 4 — write these yourself. Hint: mock the api module with
//   // vi.spyOn(api, "checkSystem").mockResolvedValue(...) / .mockRejectedValue(...)
//   // then click the button and assert the Online list / Offline message.
//   it.todo("shows Online and the seeded categories on success");
//   it.todo("shows an Offline error message when the API is unavailable");