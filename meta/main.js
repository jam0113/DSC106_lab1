import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
// Lab 8 Step 3.3: Scrollama for scrollytelling
import scrollama from 'https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm';

// Scales are global so the brush functions (Lab 6 Step 5) can use them
let xScale;
let yScale;
let rScale;
let colorScale;

// Lab 8 Step 2.4: one color per technology (html, css, js, ...)
const techColors = d3.scaleOrdinal(d3.schemeTableau10);

// Chart size, shared by renderScatterPlot and updateScatterPlot
const width = 1000;
const height = 600;
const margin = { top: 10, right: 10, bottom: 30, left: 20 };
const usableArea = {
  top: margin.top,
  right: width - margin.right,
  bottom: height - margin.bottom,
  left: margin.left,
  width: width - margin.left - margin.right,
  height: height - margin.top - margin.bottom,
};

// Lab 6 Step 1.1: read loc.csv and convert the number and date columns
async function loadData() {
  const data = await d3.csv('loc.csv', (row) => ({
    ...row,
    line: Number(row.line),
    depth: Number(row.depth),
    length: Number(row.length),
    date: new Date(row.date + 'T00:00' + row.timezone),
    datetime: new Date(row.datetime),
  }));

  return data;
}

// Lab 6 Step 1.2: one object per commit
function processCommits(data) {
  return (
    d3
      .groups(data, (d) => d.commit)
      .map(([commit, lines]) => {
        let first = lines[0];
        let { author, date, time, timezone, datetime } = first;
        let ret = {
          id: commit,
          url: 'https://github.com/jam0113/DSC106_lab1/commit/' + commit,
          author,
          date,
          time,
          timezone,
          datetime,
          // e.g. 2:30 PM = 14.5
          hourFrac: datetime.getHours() + datetime.getMinutes() / 60,
          totalLines: lines.length,
        };

        // Keep the raw lines, but hide them from console.log and loops
        Object.defineProperty(ret, 'lines', {
          value: lines,
          configurable: false,
          writable: false,
          enumerable: false,
        });

        return ret;
      })
      // Lab 8 Step 3.3: oldest first, so the story and the slider go in time order
      .sort((a, b) => a.datetime - b.datetime)
  );
}

// Lab 6 Step 1.3 (+ Lab 8 Step 1.2 exercise): summary stats for the given commits.
// Clears #stats first so it can be called again whenever the filter changes.
function renderCommitInfo(commits) {
  const lines = commits.flatMap((d) => d.lines);

  const container = d3.select('#stats');
  container.selectAll('*').remove();
  const dl = container.append('dl').attr('class', 'stats');

  // Total lines of code
  dl.append('dt').html('Total <abbr title="Lines of code">LOC</abbr>');
  dl.append('dd').text(lines.length);

  // Total commits
  dl.append('dt').text('Total commits');
  dl.append('dd').text(commits.length);

  // Number of files
  dl.append('dt').text('Files');
  dl.append('dd').text(d3.group(lines, (d) => d.file).size);

  // Longest file, in lines
  const fileLengths = d3.rollups(
    lines,
    (v) => d3.max(v, (v) => v.line),
    (d) => d.file,
  );
  dl.append('dt').text('Longest file (lines)');
  dl.append('dd').text(d3.max(fileLengths, (d) => d[1]));

  // Deepest nesting level
  dl.append('dt').text('Max depth');
  dl.append('dd').text(d3.max(lines, (d) => d.depth));

  // Time of day when most lines were written
  const workByPeriod = d3.rollups(
    lines,
    (v) => v.length,
    (d) => d.datetime.toLocaleString('en', { dayPeriod: 'short' }),
  );
  const maxPeriod = d3.greatest(workByPeriod, (d) => d[1])?.[0] ?? '';
  dl.append('dt').text('Most work done');
  dl.append('dd').text(maxPeriod.replace(/^in the |^at /, ''));
}

// Lab 6 Step 2: draw the parts of the scatterplot that never change
// (svg, y axis, gridlines, empty x axis and dots groups, brush).
// The parts that depend on the filtered commits are drawn by updateScatterPlot.
function renderScatterPlot(commits) {
  const svg = d3
    .select('#chart')
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  xScale = d3.scaleTime().range([usableArea.left, usableArea.right]);

  yScale = d3
    .scaleLinear()
    .domain([0, 24])
    .range([usableArea.bottom, usableArea.top]);

  // Lab 6 Step 4: dot area grows with lines edited.
  // The domain uses ALL commits, so a commit keeps its size while the filter changes.
  const [minLines, maxLines] = d3.extent(commits, (d) => d.totalLines);
  rScale = d3.scaleSqrt().domain([minLines, maxLines]).range([3, 30]);

  // Optional challenge: blue at night, orange during the day
  colorScale = d3
    .scaleLinear()
    .domain([0, 6, 12, 18, 24])
    .range(['#1f4e9c', '#6a8fd4', '#f28e2b', '#d6762b', '#1f4e9c'])
    .interpolate(d3.interpolateHcl);

  // Lab 6 Step 2.3: gridlines go first so they sit behind everything else
  svg
    .append('g')
    .attr('class', 'gridlines')
    .attr('transform', `translate(${usableArea.left}, 0)`)
    .call(d3.axisLeft(yScale).tickFormat('').tickSize(-usableArea.width));

  // Lab 8 Step 1.2: the axes get classes so updateScatterPlot can find the x axis
  svg
    .append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0, ${usableArea.bottom})`);

  svg
    .append('g')
    .attr('class', 'y-axis')
    .attr('transform', `translate(${usableArea.left}, 0)`)
    .call(
      d3
        .axisLeft(yScale)
        .tickFormat((d) => String(d % 24).padStart(2, '0') + ':00'),
    );

  svg.append('g').attr('class', 'dots');

  createBrushSelector(svg);
  updateScatterPlot(commits);
}

// Lab 8 Step 1.2: update the x axis and the dots for the filtered commits
function updateScatterPlot(commits) {
  const svg = d3.select('#chart').select('svg');

  // The x axis zooms to the commits being shown. With a single commit the
  // extent has zero width, so pad it by a day on each side.
  let [minDate, maxDate] = d3.extent(commits, (d) => d.datetime);
  if (+minDate === +maxDate) {
    minDate = d3.timeDay.offset(minDate, -1);
    maxDate = d3.timeDay.offset(maxDate, 1);
  }
  xScale.domain([minDate, maxDate]).nice();

  // Date at midnight ("Oct 04"), hour otherwise ("6 PM"), so labels never
  // switch to a month name halfway through like D3's default format does
  const xAxis = d3
    .axisBottom(xScale)
    .ticks(6)
    .tickFormat((d) =>
      d3.timeDay(d) < d ? d3.timeFormat('%-I %p')(d) : d3.timeFormat('%b %d')(d),
    );

  // Clear the old x axis and draw the new one
  const xAxisGroup = svg.select('g.x-axis');
  xAxisGroup.selectAll('*').remove();
  xAxisGroup.call(xAxis);

  // Lab 6 Step 4.3: big dots first so small ones stay on top and hoverable
  const sortedCommits = d3.sort(commits, (d) => -d.totalLines);

  svg
    .select('g.dots')
    .selectAll('circle')
    // Lab 8 Step 1.3: key by commit id, so each commit keeps its own circle
    .data(sortedCommits, (d) => d.id)
    .join('circle')
    .attr('cx', (d) => xScale(d.datetime))
    .attr('cy', (d) => yScale(d.hourFrac))
    .attr('r', (d) => rScale(d.totalLines))
    // Lab 8 Step 1.4: radius as a CSS variable, so bigger circles grow for longer
    .style('--r', (d) => rScale(d.totalLines))
    .attr('fill', (d) => colorScale(d.hourFrac))
    .style('fill-opacity', 0.7)
    .on('mouseenter', (event, commit) => {
      d3.select(event.currentTarget).style('fill-opacity', 1);
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on('mousemove', (event) => {
      updateTooltipPosition(event);
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).style('fill-opacity', 0.7);
      updateTooltipVisibility(false);
    });

  // The dots moved, so re-check which ones are inside the brush (if any)
  updateSelection(d3.brushSelection(svg.node()));
}

// Lab 6 Step 3.1: fill in the tooltip
function renderTooltipContent(commit) {
  const link = document.getElementById('commit-link');
  const date = document.getElementById('commit-date');
  const time = document.getElementById('commit-clock');
  const author = document.getElementById('commit-author');
  const lines = document.getElementById('commit-lines');

  if (Object.keys(commit).length === 0) return;

  link.href = commit.url;
  link.textContent = commit.id;
  date.textContent = commit.datetime?.toLocaleString('en', {
    dateStyle: 'full',
  });
  time.textContent = commit.datetime?.toLocaleString('en', {
    timeStyle: 'short',
  });
  author.textContent = commit.author;
  lines.textContent = commit.totalLines;
}

// Lab 6 Step 3.3: show or hide the tooltip
function updateTooltipVisibility(isVisible) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.hidden = !isVisible;
}

// Lab 6 Step 3.4: put the tooltip next to the mouse,
// flipping to the other side if it would go off the screen
function updateTooltipPosition(event) {
  const tooltip = document.getElementById('commit-tooltip');
  const offset = 12;
  const { width, height } = tooltip.getBoundingClientRect();

  let left = event.clientX + offset;
  let top = event.clientY + offset;

  if (left + width > window.innerWidth) left = event.clientX - offset - width;
  if (top + height > window.innerHeight) top = event.clientY - offset - height;

  tooltip.style.left = `${Math.max(0, left)}px`;
  tooltip.style.top = `${Math.max(0, top)}px`;
}

// Lab 6 Steps 5.1 and 5.2: brush, with dots raised above the overlay so hover still works
function createBrushSelector(svg) {
  svg.call(d3.brush().on('start brush end', brushed));
  svg.selectAll('.dots, .overlay ~ *').raise();
}

// Lab 6 Step 5.4: highlight dots inside the brush
function brushed(event) {
  updateSelection(event.selection);
}

function updateSelection(selection) {
  d3.selectAll('#chart circle').classed('selected', (d) =>
    isCommitSelected(selection, d),
  );
  renderSelectionCount(selection);
  renderLanguageBreakdown(selection);
}

function isCommitSelected(selection, commit) {
  if (!selection) {
    return false;
  }
  const [x0, x1] = selection.map((d) => d[0]);
  const [y0, y1] = selection.map((d) => d[1]);
  const x = xScale(commit.datetime);
  const y = yScale(commit.hourFrac);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

// Lab 6 Step 5.5: number of selected commits (only those currently shown)
function renderSelectionCount(selection) {
  const selectedCommits = selection
    ? filteredCommits.filter((d) => isCommitSelected(selection, d))
    : [];

  const countElement = document.querySelector('#selection-count');
  countElement.textContent = `${
    selectedCommits.length || 'No'
  } commits selected`;

  return selectedCommits;
}

// Lab 6 Step 5.6: lines per language in the selected commits
function renderLanguageBreakdown(selection) {
  const selectedCommits = selection
    ? filteredCommits.filter((d) => isCommitSelected(selection, d))
    : [];
  const container = document.getElementById('language-breakdown');

  if (selectedCommits.length === 0) {
    container.innerHTML = '';
    return;
  }
  const lines = selectedCommits.flatMap((d) => d.lines);

  const breakdown = d3.rollup(
    lines,
    (v) => v.length,
    (d) => d.type,
  );

  container.innerHTML = '';

  for (const [language, count] of breakdown) {
    const proportion = count / lines.length;
    const formatted = d3.format('.1~%')(proportion);

    container.innerHTML += `
      <dt>${language}</dt>
      <dd>${count} lines (${formatted})</dd>
    `;
  }
}

// Lab 8 Steps 2.1-2.4: unit visualization, one dot per line, grouped by file
function updateFileDisplay(commits) {
  const lines = commits.flatMap((d) => d.lines);
  const files = d3
    .groups(lines, (d) => d.file)
    .map(([name, lines]) => {
      return { name, lines };
    })
    // Step 2.3: biggest file first
    .sort((a, b) => b.lines.length - a.lines.length);

  const filesContainer = d3
    .select('#files')
    .selectAll('div')
    .data(files, (d) => d.name)
    .join(
      // This code only runs when the div is initially rendered
      (enter) =>
        enter.append('div').call((div) => {
          div.append('dt');
          div.append('dd');
        }),
    );

  // Step 2.2: file name, with the line count underneath
  filesContainer
    .select('dt')
    .html((d) => `<code>${d.name}</code><small>${d.lines.length} lines</small>`);

  // Steps 2.2 and 2.4: one dot per line, colored by technology
  filesContainer
    .select('dd')
    .selectAll('div')
    .data((d) => d.lines)
    .join('div')
    .attr('class', 'loc')
    .attr('style', (d) => `--color: ${techColors(d.type)}`);
}

// Lab 8 Step 3.2: one paragraph of story per commit
function renderScatterStory(commits) {
  d3.select('#scatter-story')
    .selectAll('.step')
    .data(commits)
    .join('div')
    .attr('class', 'step')
    .html((d, i) => {
      const fileCount = d3.rollups(
        d.lines,
        (D) => D.length,
        (d) => d.file,
      ).length;
      return `
        On ${d.datetime.toLocaleString('en', {
          dateStyle: 'full',
          timeStyle: 'short',
        })},
        I made <a href="${d.url}" target="_blank">${
          i > 0 ? 'another commit' : 'my first commit'
        }</a>.
        I edited ${d.totalLines} lines across ${fileCount} ${
          fileCount === 1 ? 'file' : 'files'
        }.
      `;
    });
}

let data = await loadData();
let commits = processCommits(data);

// Lab 8 Step 1.1: slider position (0-100) <-> date
let commitProgress = 100;
const timeScale = d3
  .scaleTime()
  .domain([
    d3.min(commits, (d) => d.datetime),
    d3.max(commits, (d) => d.datetime),
  ])
  .range([0, 100]);
let commitMaxTime = timeScale.invert(commitProgress);

// Lab 8 Step 1.2: will get updated as the user moves the slider or scrolls
let filteredCommits = commits;

const slider = document.getElementById('commit-progress');
const sliderTime = document.getElementById('commit-time');

// Show only the commits up to commitMaxTime, everywhere on the page
function updateAll() {
  filteredCommits = commits.filter((d) => d.datetime <= commitMaxTime);

  sliderTime.textContent = commitMaxTime.toLocaleString('en', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  renderCommitInfo(filteredCommits);
  updateScatterPlot(filteredCommits);
  updateFileDisplay(filteredCommits);
}

// Lab 8 Step 1.1: slider handler
function onTimeSliderChange() {
  commitProgress = Number(slider.value);
  commitMaxTime = timeScale.invert(commitProgress);
  updateAll();
}

// Lab 8 Step 3.3: when a commit's paragraph reaches the middle of the screen,
// show the repo as it was at that commit (and move the slider to match)
function onStepEnter(response) {
  commitMaxTime = response.element.__data__.datetime;
  commitProgress = timeScale(commitMaxTime);
  slider.value = commitProgress;
  updateAll();
}

renderScatterPlot(commits);
renderScatterStory(commits);

slider.addEventListener('input', onTimeSliderChange);
onTimeSliderChange();

const scroller = scrollama();
scroller
  .setup({
    container: '#scrolly-1',
    step: '#scrolly-1 .step',
  })
  .onStepEnter(onStepEnter);
