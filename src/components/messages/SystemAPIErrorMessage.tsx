import * as React from 'react'
import { useState } from 'react'
import { Box, Text } from 'src/ink.js'
import { formatAPIError } from 'src/services/api/errorUtils.js'
import type { SystemAPIErrorMessage as SystemAPIErrorMessageType } from 'src/types/message.js'
import { useInterval } from 'usehooks-ts'
import { CtrlOToExpand } from '../CtrlOToExpand.js'
import { MessageResponse } from '../MessageResponse.js'

const MAX_API_ERROR_CHARS = 1000
type Props = {
  message: SystemAPIErrorMessageType
  verbose: boolean
}

export function SystemAPIErrorMessage({
  message: { retryAttempt, error, retryInMs, maxRetries },
  verbose,
}: Props): React.ReactNode {
  // Hide early retries to reduce noise in interactive use.
  const hidden = retryAttempt < 4

  const [countdownMs, setCountdownMs] = useState(0)
  const done = countdownMs >= retryInMs

  useInterval(
    () => setCountdownMs(ms => ms + 1000),
    hidden || done ? null : 1000,
  )

  if (hidden) {
    return null
  }

  const retryInSecondsLive = Math.max(
    0,
    Math.round((retryInMs - countdownMs) / 1000),
  )
  const formatted = formatAPIError(error)
  const isTimeoutError = /timed out|timeout/i.test(formatted)
  const truncated = !verbose && formatted.length > MAX_API_ERROR_CHARS
  const displayText = truncated
    ? formatted.slice(0, MAX_API_ERROR_CHARS) + '…'
    : formatted
  const retryUnit = retryInSecondsLive === 1 ? 'second' : 'seconds'
  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">{displayText}</Text>
        {truncated && <CtrlOToExpand />}
        <Text dimColor>
          Retrying in {retryInSecondsLive} {retryUnit}… (attempt {retryAttempt}/
          {maxRetries})
          {isTimeoutError && process.env.API_TIMEOUT_MS
            ? ` · API_TIMEOUT_MS=${process.env.API_TIMEOUT_MS}ms, try increasing it`
            : ''}
        </Text>
      </Box>
    </MessageResponse>
  )
}
