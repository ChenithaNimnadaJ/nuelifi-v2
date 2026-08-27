# Paddle amount attribution notes

Source: https://developer.paddle.com/webhooks/transactions/transaction-completed — official Paddle `transaction.completed` webhook documentation.

Source: https://developer.paddle.com/api-reference/transactions/get-transaction — official Paddle transaction API documentation.

The transaction schema documents `data.details.totals` for calculated transaction totals and explains that monetary `amount` values are represented as strings in the currency's lowest denomination (for example, 1000 for 10 USD). The Worker therefore reads the completed transaction total and divides by 100 before sending `p_paid_amount` to the commission RPC. Non-transaction activation events retain the existing canonical plan-catalog fallback because they may not carry a completed transaction total.
