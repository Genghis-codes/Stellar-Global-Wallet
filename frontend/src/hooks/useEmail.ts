"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query/keys";
import { useAuth } from "./useAuth";

/** Verified notification email for the signed-in account. */
export function useEmailStatus() {
  const { account } = useAuth();
  return useQuery({
    queryKey: queryKeys.email.all(account ?? ""),
    queryFn: ({ signal }) => api.email.get(signal),
    enabled: Boolean(account),
  });
}

/** Send (or re-send) a verification link to an address. */
export function useSubmitEmail() {
  return useMutation({ mutationFn: (email: string) => api.email.submit(email) });
}

/** Confirm a verification token, then refresh the email status. */
export function useVerifyEmail() {
  const { account } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.email.verify(token),
    onSuccess: ({ email }) => {
      queryClient.setQueryData(queryKeys.email.all(account ?? ""), { email, verified: true });
    },
  });
}
