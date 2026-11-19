<?php
require_once __DIR__ . '/app_config.php';

function membership_max_months(DateTimeImmutable $start): int
{
    $year = (int)$start->format('Y');
    if ($year < 1000 || $year > 9999) return 0;
    return (9999 - $year) * 12 + 12 - (int)$start->format('n');
}

// Keep the signup day where possible; shorter target months use their last day.
function membership_end_date(DateTimeImmutable $start, int $months): string
{
    $year = (int)$start->format('Y');
    $month = (int)$start->format('n');
    $maxMonths = membership_max_months($start);
    if ($year < 1000 || $year > 9999 || $months < 1 || $months > $maxMonths) {
        throw new InvalidArgumentException('Invalid membership duration.');
    }
    // Move from day 1 so PHP cannot carry an overflowing day into the next month.
    $target = $start->setDate($year, $month, 1)->modify('+' . $months . ' months');
    $day = min((int)$start->format('j'), (int)$target->format('t'));
    return $target->setDate((int)$target->format('Y'), (int)$target->format('n'), $day)->format('Y-m-d');
}
