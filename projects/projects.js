import { fetchJSON, renderProjects } from '../global.js';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

const projects = await fetchJSON('../lib/projects.json');
const projectsContainer = document.querySelector('.projects');
const projectsTitle = document.querySelector('.projects-title');
const searchInput = document.querySelector('.searchBar');

const svg = d3.select('#projects-pie-plot');
const legend = d3.select('.legend');

// Colors are keyed by year, so a year keeps its color when the pie is filtered
const colors = d3.scaleOrdinal(d3.schemeTableau10);
const arcGenerator = d3.arc().innerRadius(0).outerRadius(50);
const sliceGenerator = d3
  .pie()
  .value((d) => d.value)
  .sort(null);

// Step 5.4: both filters live here, so neither one overwrites the other.
// We store the selected year, not the wedge index, because a wedge's index
// changes whenever a search changes which years are in the pie.
let query = '';
let selectedYear = null;

function matchesQuery(project) {
  const values = Object.values(project).join('\n').toLowerCase();
  return values.includes(query.toLowerCase());
}

function selectYear(year) {
  selectedYear = selectedYear === year ? null : year;
  update();
}

// Steps 1-3: draw the pie and legend for the given projects
function renderPieChart(projectsGiven) {
  const rolledData = d3.rollups(
    projectsGiven,
    (v) => v.length,
    (d) => d.year,
  );
  const data = rolledData.map(([year, count]) => {
    return { value: count, label: year };
  });
  const arcs = sliceGenerator(data).map((d) => arcGenerator(d));

  // Clear the previous render so wedges and legend items don't pile up
  svg.selectAll('path').remove();
  legend.selectAll('li').remove();

  data.forEach((d, i) => {
    const selectedClass = d.label === selectedYear ? 'selected' : null;

    svg
      .append('path')
      .attr('d', arcs[i])
      .attr('fill', colors(d.label))
      .attr('class', selectedClass)
      .on('click', () => selectYear(d.label));

    legend
      .append('li')
      .attr('style', `--color:${colors(d.label)}`)
      .attr('class', d.label === selectedYear ? 'legend-item selected' : 'legend-item')
      .html(`<span class="swatch"></span> ${d.label} <em>(${d.value})</em>`)
      .on('click', () => selectYear(d.label));
  });
}

// Apply the search and the selected year together, then redraw everything
function update() {
  const searchedProjects = projects.filter(matchesQuery);
  const visibleProjects =
    selectedYear === null
      ? searchedProjects
      : searchedProjects.filter((project) => project.year === selectedYear);

  renderProjects(visibleProjects, projectsContainer, 'h2');
  // The pie shows every year matching the search, so you can switch years
  renderPieChart(searchedProjects);

  // Lab 4 Step 1.6: count the projects currently shown
  if (projectsTitle) {
    const count = visibleProjects.length;
    projectsTitle.textContent = `${count} ${count === 1 ? 'Project' : 'Projects'}`;
  }
}

// Step 4: search updates as you type
searchInput.addEventListener('input', (event) => {
  query = event.target.value;
  update();
});

update();
